# Your First Call

This walkthrough creates the smallest useful inbound call path: register a SIP extension, point an inbound DID at a flow, publish `Start -> Play Audio -> Hangup`, and dial in.

1. Open the dashboard at `http://localhost:3000`.

   This is the React dashboard served by the frontend container. Keep the backend running on port `3001` in the same stack because the dashboard reads and writes configuration through the NestJS API.

2. Go to Configure -> Extensions. Add a new SIP extension — give it a number, a display name, and a password.

   This is the credential your softphone will register with. Use a real password because the extension becomes a SIP identity inside Asterisk.

3. Go to Configure -> Inbound. Create an inbound route — assign a DID number and select a flow.

   If you have no flows yet, leave it and come back after step 5. The DID is the number Asterisk will match when a call enters the system.

4. Go to Configure -> Flow Builder. Create a new flow.

   Drag a Start node, connect it to a Play Audio node, connect that to a Hangup node. Upload or select an audio file for the Play Audio node so the test call has something audible to play.

5. Click Publish.

   The flow is now live — any call hitting the assigned DID will execute it immediately. Draft edits after this point will not affect live calls until you publish again.

6. Register your softphone using the extension credentials and the server IP on port `5080`.

   Linphone, Zoiper, or any SIP client will work. Dial the DID from the softphone and you should hear your audio file play.

---

## Making an outbound call from your softphone

Callytics supports direct outbound dialing from any registered softphone without using mobile credits. Calls go out through your configured SIP trunk.

1. Go to Configure -> Trunks. Create a SIP trunk with your provider credentials.

2. Go to Settings and set that trunk as the **default outbound trunk**.

3. Register your softphone to the Callytics server at `<host-ip>:5080` using an extension credential.

4. From your softphone, dial the external number, for example:

   ```
   0612345678
   +94771234567
   ```

   - Callytics converts the number to E.164 (`0612345678` becomes `+31612345678`, `0044...` becomes `+44...`, `+44...` stays as it is, short numbers like `112` stay as they are)
   - Extension numbers and inbound DIDs are never sent to the trunk
   - Dialing `#` followed by the number (for example `#94771234567`) always dials out as well
   - Settings > Outbound dialing controls this: turn off "Dial external numbers without #" to require the `#` prefix, turn off "Convert dialed numbers to E.164" to send the number as dialed, and set the country code (default `31`) and international prefix (default `00`)

5. You will hear music on hold immediately while Callytics connects the call through your trunk.

6. Go to Call Logs in the dashboard — the call will appear with direction set to `outbound`.

> This works over the relay too: your softphone connects to the VPS, dials the number, and the outbound call goes out through your trunk on the Callytics host. No direct internet path needed from your phone.

