# Momentum Tasks

A Material 3 task tracker for the calendar and task lists people already use, with completion notices and a momentum coach.

- **First-run setup**: new people pick where their email and calendar live, connect it, see what was found, and land on their tasks.
- **Tasks**: every open task, grouped as Overdue / Due today / Upcoming / No due date, with filter chips. Open a task to set or change its due date, mark it done, or set up a completion notice.
- **Completion notices**: when a task is checked off, email someone automatically (Google and Microsoft accounts), or open a ready-to-send email or text.
- **History**: completed tasks by day for this week, by week for the four weeks before, then by month.
- **Momentum**: this week vs. the same point last week, on-time rate, streak, XP and levels, an 8-week chart and milestones. When you're slipping, it says so and gives you a focus list of the three most urgent tasks.

Styling uses the Material 3 baseline color scheme and type scale, the same tokens as the *Material 3 Design Kit* library in the Figma file.

## Supported providers

| Provider | How it connects | Calendar | Tasks | Completion emails |
| --- | --- | --- | --- | --- |
| Google (Gmail, Workspace) | Sign in with Google | Google Calendar, read-only | Google Tasks, two-way | Sent from their Gmail |
| Microsoft (Outlook.com, Hotmail, Live, Microsoft 365) | Sign in with Microsoft | Outlook Calendar, read-only | Microsoft To Do, two-way | Sent from their Outlook |
| Yahoo | Import a calendar file (.ics) | Imported events | Imported to-dos | Opens their mail app |
| Apple iCloud | Import a calendar file (.ics) | Imported events | Imported to-dos | Opens their mail app |
| Anything else | Import a calendar file (.ics) | Imported events | Imported to-dos | Opens their mail app |

Yahoo and Apple don't offer a sign-in API that a web app can use for calendars or tasks. Their calendars only sync over CalDAV with an app-specific password, and browsers block those requests. The onboarding walks people through exporting an .ics file instead. Texts open the phone's messaging app with the message filled in; sending texts with no tap would need a paid SMS service and a server.

## Run it locally

No build step and no dependencies. From this folder:

```bash
python3 -m http.server 5180 --bind 127.0.0.1
```

Open http://localhost:5180. To start over as a brand-new user, clear the site's data in your browser.

## Share it with others

You do this setup once. The people you share with then just pick a provider and sign in.

### 1. Host it on HTTPS

Any static host works, for example GitHub Pages, Netlify or Cloudflare Pages. Upload this folder as is. Note the URL, for example `https://you.github.io/momentum-tasks/`.

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project, then **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add your hosted origin (for example `https://you.github.io`) and `http://localhost:5180`.
3. Enable the **Google Calendar API**, **Google Tasks API** and **Gmail API**.
4. Set up the **OAuth consent screen**.
   - While the app is in **Testing**, only Google accounts you add as test users can sign in (up to 100).
   - To open it to anyone, publish the app and complete Google's verification. The Calendar, Tasks and Gmail-send permissions are classed as *sensitive*. Until verified, people see an "unverified app" warning.
5. Paste the client ID into `js/config.js` as `googleClientId`.

### 3. Microsoft sign-in

1. In the [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade), choose **New registration**.
2. Under **Supported account types**, choose *Accounts in any organizational directory and personal Microsoft accounts*.
3. Under **Redirect URI**, pick **Single-page application (SPA)** and add `https://<your-host>/<path>/auth-callback.html`. Also add `http://localhost:5180/auth-callback.html`.
4. Under **API permissions**, add these Microsoft Graph *delegated* permissions: `User.Read`, `Calendars.Read`, `Tasks.ReadWrite`, `Mail.Send` and `offline_access`.
5. Paste the **Application (client) ID** into `js/config.js` as `microsoftClientId`.

Some work or school organizations require an admin to approve third-party apps. Personal Outlook.com, Hotmail and Live accounts don't.

Client IDs are public identifiers, not secrets, so it's fine for them to be in `config.js`. If a provider's ID is left empty, onboarding shows that option as "not set up yet".

## How it works

- Runs entirely in the browser. Tasks, history and settings live in `localStorage`. Google and Microsoft are called directly with short-lived tokens, so there's no server and no database.
- **Task lists sync both ways**: checking off a Google Task or Microsoft To Do item, or changing its due date, updates the source. Those services store dates only, so there's no time field for them.
- **Calendar events** from the past 7 days and the next 30 days show up as tasks, due when the event ends. Calendars are never changed: completions and custom due dates are stored in the app. Use **Not a task** to hide an event, or turn events off in Settings.
- **Imported .ics files** bring in events from the same window, plus every to-do (VTODO). People can import a newer file from Settings at any time. Repeating events only appear if their first occurrence falls in the window.
- **Momentum** compares completions so far this week with last week up to the same day and time: "building" when ahead, "steady" when even, "slipping" when behind.

## Accessibility

Checked with axe-core 4.10.2, the engine used by the `scan-code-accessibility-figma` skill. The scan ran in a real browser, so color contrast and target size were checked too. Every screen and onboarding step had 0 violations in both light and dark mode. Manual checks:

- **Keyboard**: everything is reachable, with a visible focus ring. Task rows have a separate checkbox and details button.
- **Dialogs**: the task dialog traps focus, blocks the page behind it (`inert`), closes on Escape and returns focus to where you were.
- **Screen readers**: focus moves to the new heading on each screen and onboarding step. Icons are hidden from screen readers. Status and errors are announced. The page title updates per screen.
- **Layout**: no horizontal scrolling at 320px wide.
- **Motion**: honors reduced-motion settings. Snackbars pause while hovered or focused.

## Files

| File | What it does |
| --- | --- |
| `index.html` | App shell: top app bar, nav bar, + button |
| `auth-callback.html` | Receives the Microsoft sign-in response |
| `styles.css` | M3 tokens (light and dark), components, onboarding |
| `js/config.js` | Your Google and Microsoft client IDs |
| `js/app.js` | Screens, task dialog, actions, sync |
| `js/onboarding.js` | First-run flow |
| `js/providers/` | Google, Microsoft and .ics import |
| `js/momentum.js` | Stats, levels, streaks and coaching copy |
| `js/store.js`, `js/dates.js` | Storage and date helpers |
| `js/demo.js` | Sample data |
