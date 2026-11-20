import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = process.env.TABLE_NAME;
const workspace = process.env.WORKSPACE_ID || 'demo';
const pk = `WORKSPACE#${workspace}`;
const initial = { inside:24, total:186, peak:42, capacity:80 };
const response = (statusCode, body) => ({statusCode,headers:{'content-type':'application/json','access-control-allow-origin':process.env.ALLOWED_ORIGIN||'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,PUT,OPTIONS'},body:JSON.stringify(body)});
async function state() {
  let result=await ddb.send(new GetCommand({TableName:table,Key:{pk,sk:'STATE'}}));
  if(result.Item) return result.Item;
  const item={pk,sk:'STATE',...initial,updatedAt:new Date().toISOString()};
  try { await ddb.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk)'})); return item; }
  catch(error) { if(error.name!=='ConditionalCheckFailedException') throw error; return (await ddb.send(new GetCommand({TableName:table,Key:{pk,sk:'STATE'}}))).Item; }
}
async function snapshot() {
  const current=await state();
  const result=await ddb.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk, :event)',ExpressionAttributeValues:{':pk':pk,':event':'EVENT#'},ScanIndexForward:false,Limit:100}));
  const logs=(result.Items||[]).map(({eventId,time,type,source})=>({id:eventId,time,type,source}));
  return {...current,logs};
}
export const handler=async(event)=>{
  const method=event.requestContext?.http?.method||event.httpMethod||'GET';
  if(method==='OPTIONS') return response(204,{});
  const path=event.rawPath||event.path||'/';
  try {
    if(path.endsWith('/health')&&method==='GET') return response(200,{ok:true,mode:'aws',storage:'dynamodb'});
    if(path.endsWith('/state')&&method==='GET') return response(200,await snapshot());
    if(path.endsWith('/events')&&method==='GET') { const s=await snapshot(); return response(200,{events:s.logs}); }
    if(path.endsWith('/events')&&method==='POST') {
      const input=JSON.parse(event.body||'{}'); if(!['IN','OUT'].includes(input.type)) return response(400,{message:'Event type must be IN or OUT.'});
      for(let attempt=0;attempt<5;attempt++) {
        const old=await state();
        if(input.type==='OUT'&&old.inside<=0) return response(409,{message:'The space is already empty.'});
        if(input.type==='IN'&&old.inside>=old.capacity) return response(409,{message:'Capacity reached. No more entries can be recorded.'});
        const inside=old.inside+(input.type==='IN'?1:-1), total=old.total+(input.type==='IN'?1:0), peak=Math.max(old.peak,inside);
        const now=new Date(); const eventId=`EVT-${randomUUID().slice(0,8).toUpperCase()}`;
        const item={pk,sk:`EVENT#${now.toISOString()}#${eventId}`,eventId,time:now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'}),type:input.type,source:String(input.source||'Front entrance').slice(0,80),createdAt:now.toISOString()};
        try {
          await ddb.send(new TransactWriteCommand({TransactItems:[
            {Update:{TableName:table,Key:{pk,sk:'STATE'},UpdateExpression:'SET inside=:inside, total=:total, peak=:peak, updatedAt=:now',ConditionExpression:'inside=:old AND capacity=:capacity',ExpressionAttributeValues:{':inside':inside,':total':total,':peak':peak,':old':old.inside,':capacity':old.capacity,':now':now.toISOString()}}},
            {Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk)'}}
          ]}));
          const result=await snapshot(); return response(201,{state:result,logs:result.logs});
        } catch(error) { if(error.name==='TransactionCanceledException'&&attempt<4) continue; throw error; }
      }
      return response(409,{message:'Counter changed repeatedly. Please retry.'});
    }
    if(path.endsWith('/settings')&&method==='PUT') {
      const input=JSON.parse(event.body||'{}'), capacity=Number(input.capacity);
      if(!Number.isInteger(capacity)||capacity<1||capacity>100000) return response(400,{message:'Capacity must be a whole number from 1 to 100000.'});
      const old=await state();
      await ddb.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:table,Key:{pk,sk:'STATE'},UpdateExpression:'SET capacity=:capacity, updatedAt=:now',ConditionExpression:'inside=:inside AND capacity=:old',ExpressionAttributeValues:{':capacity':capacity,':inside':old.inside,':old':old.capacity,':now':new Date().toISOString()}}}]}));
      return response(200,await snapshot());
    }
    return response(404,{message:'Route not found.'});
  } catch(error) { console.error('Sentri request failed',error); return response(error.name==='ConditionalCheckFailedException'?409:500,{message:error.name==='ConditionalCheckFailedException'?'Counter changed; refresh and retry.':'Sentri could not complete the request.'}); }
};

