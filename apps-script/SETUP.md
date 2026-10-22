# Life Board sync setup (about 10 minutes)

## 1. Make the Sheet and script
1. Create a new Google Sheet named **Life Board Data**.
2. **Extensions → Apps Script**. Delete what's there, paste all of `Code.gs` from this folder, click **Save**.
3. Pick **setup** in the function dropdown and click **Run**. Approve access (Advanced → Go to project → Allow).
4. Open **Execution log** and copy the line `Your Life Board key: …`. That's your key.

## 2. Publish it as a web app
1. **Deploy → New deployment** → gear icon → **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, then copy the **Web app URL** (ends in `/exec`).

"Anyone" means anyone with the URL can reach the script, but every request is rejected without your key. Don't share the key.

## 3. Connect each device
In the app: **cog → Sync** → paste the URL and key → **Connect**. Do your phone first (it has your data), then the work browser and anything else.

## 4. Siri: "Hey Siri, Life Board"
In the **Shortcuts** app → **+**:
1. **Dictate Text**. Stop Listening: After Pause.
2. **Get Contents of URL**. URL: your `/exec` URL. Tap the arrow: Method **POST**, Request Body **JSON**, add three Text fields:
   - `action` = `add`
   - `token` = your key
   - `text` = *Dictated Text* (pick the variable)
3. **Show Notification**: `Added to Life Board`.
4. Name the shortcut **Life Board**.

Say "Hey Siri, Life Board", then "Task call mom tomorrow at 6" or "Note ask Sam about QA". It lands in the Sheet's Inbox and shows up in the app on its next sync (open the app, or within 2 minutes while it's open). Spanish works too: "Tarea…", "Nota…".

## Updating the script later
Paste the new code, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same.
