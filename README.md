# Sentri Smart Visitor Counter

A runnable visitor counter project built from the supplied Sentri dashboard. It includes a browser dashboard, a local Node.js API with file-backed demo data, and an AWS SAM backend using API Gateway, Lambda, and DynamoDB.

## What works

- Overview metrics, live occupancy, entry/exit recording, capacity limits, activity history, CSV export, settings, and navigation.
- Local demo: the browser calls the local API; data persists in `local/sentri-data.json`.
- AWS mode: the same browser calls API Gateway; Lambda validates events and stores the workspace counter and event history in DynamoDB.
- The dashboard refreshes from its API every 15 seconds and shows whether it is in demo or AWS mode.

The uploaded page had an invalid doctype/style opening and hard-coded demo behavior. Those syntax issues are fixed, and controls that previously only changed presentation now use the API.

## Requirements

- Local demo: Node.js 20 or newer. No npm install is needed for the demo.
- AWS backend: AWS CLI credentials configured for the deployment account, AWS SAM CLI, and Node.js/npm for packaging the Lambda dependencies.

## Run the local demo

From this project folder:

```powershell
npm start
```

Open `http://localhost:4173`. In VS Code, open **Run and Debug** and choose **Sentri: Run local demo**, or press **F5**. The server starts in the integrated terminal. The server creates `local/sentri-data.json` the first time it runs. Use **Reset demo** on the counter to return to its sample state. The local demo writes only to that JSON file; it does not connect to AWS.

## Deploy the AWS backend

1. Configure AWS CLI credentials for the intended account and region, then confirm the selected account and region before deployment.
2. In the project folder, install the Lambda dependencies and build the SAM application:

   ```powershell
   npm --prefix lambda install
   sam build
   ```

3. Deploy interactively:

   ```powershell
   sam deploy --guided
   ```

   Provide a stack name and region. For `AllowedOrigin`, use the exact origin that will host the dashboard (for example, `https://counter.example.com`). `*` is convenient for local testing but is not a security boundary and should not be used for a real deployment.
4. Copy the `ApiBaseUrl` output from the completed stack.
5. Edit `src/config.js` to use the API URL and AWS mode:

   ```js
   window.SENTRI_CONFIG = {
     apiBaseUrl: 'https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com',
     mode: 'aws'
   };
   ```

6. Host the contents of `src/` on a static web host over HTTPS (for example, an S3 bucket behind CloudFront), then open the site. The SAM template creates only the API, Lambda function, and DynamoDB table; it does not upload or publish the dashboard.

The SAM stack creates a pay-per-request DynamoDB table with encryption at rest and point-in-time recovery enabled. Its Lambda execution role is scoped to that table. The dashboard never contains AWS access keys or AWS SDK credentials.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Reports backend mode and health |
| GET | `/api/state` | Returns occupancy, totals, capacity, and recent events |
| GET | `/api/events` | Returns recent event records |
| POST | `/api/events` | Records `{ "type": "IN" | "OUT", "source": "Front entrance" }` |
| PUT | `/api/settings` | Sets `{ "capacity": 80 }` |
| POST | `/api/demo/reset` | Local demo only; restores sample values |

The Lambda checks inputs and uses a DynamoDB transaction with an optimistic condition on the previous occupancy. An event record and its counter update commit together. The local server provides the same routes and stores up to 500 recent events.

## AWS architecture

```text
Browser dashboard (static hosting)
        │ HTTPS JSON
        ▼
API Gateway HTTP API (/api/*)
        │ Lambda proxy integration
        ▼
Lambda (input validation + atomic counter updates)
        │ least-privilege table access
        ▼
DynamoDB (workspace state + ordered event items)
```

The table uses a partition key per workspace and a sort key for one state item plus ordered event items. The current starter uses a `demo` workspace by default; set `WorkspaceId` at deployment for a distinct workspace partition.

## Security and production notes

- No AWS credentials are embedded in frontend files. AWS credentials are needed only by the operator deploying the stack; Lambda uses its execution role.
- The included HTTP API has no user authentication or workspace authorization. CORS only controls browser access and does not protect the API from direct requests. Before using real visitor data, add a Cognito JWT authorizer (or another trusted identity layer) and enforce workspace-level authorization in Lambda. Restrict `AllowedOrigin` to the deployed frontend origin.
- Use a unique `WorkspaceId` per tenant and do not treat the default `demo` workspace as tenant isolation. The current browser sends a fixed demo source; do not trust a caller-provided workspace identifier.
- Consider retention and privacy requirements for event records before production. Point-in-time recovery is enabled; no automatic event expiry is configured.
- AWS costs may apply to API requests, Lambda execution, and DynamoDB usage. Review the account's pricing and budgets before deployment.

## Optional sensor ingestion

The dashboard buttons and `/api/events` endpoint are usable now. A physical sensor is not included. A sensor gateway can post entry/exit events to the API after adding authentication and device identity. For production IoT, AWS IoT Core can receive MQTT messages and an IoT Rule can invoke a separately authorized ingestion Lambda; keep device certificates in IoT Core and never place cloud keys on a sensor or in the browser.

## What is not done by this project

The stack has not been deployed, and it is not connected to your AWS account. No AWS credentials or account access were present. AWS mode becomes connected only after you deploy the SAM stack, set its API URL in `src/config.js`, and host/open the configured frontend. Until then, the local demo remains fully usable.

