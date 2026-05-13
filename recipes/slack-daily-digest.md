# Recipe: Daily Slack Digest via Email

A focused worked example of the **"claude as cron"** pattern: a systemd timer fires `claude -p` headless every morning, claude pulls Slack data through this gateway's `slack` MCP server, summarizes it, and emails you the result. Roughly 20 minutes of setup on a fresh box once the prerequisites are in place.

The recipe is end-to-end — copy-paste each block, swap a couple of placeholders, and you'll have a working morning digest. The shape generalizes (see "Variations" at the bottom).

---

## What you get

Each morning at 8 AM (your local time), an HTML email lands in your inbox with:

- **Priority** — DMs and `@`-mentions from the last 24 hours
- **By channel** — one short paragraph per channel that actually had activity (silent channels are skipped)
- **Action items** — anything that needs a response

The example below targets a Burnt Slack workspace, but the only thing workspace-specific is the channel list inside the prompt — swap it for yours.

---

## Prerequisites

1. **MCP Supergateway Hub running somewhere on your LAN** — see this repo's main `README.md`. The Slack server's HTTP endpoint (default port `3232`) needs to be reachable from the box that'll run the cron. Confirm with `curl http://YOUR_GATEWAY_HOST:3232/mcp` (you should get an MCP handshake response).
2. **A Linux box with systemd** to host the cron job. Doesn't need to be the same machine as the gateway.
3. **A Gmail account with an app password** — generate one at <https://myaccount.google.com/apppasswords>. 2FA must already be enabled. (Other SMTP providers work too; this recipe uses Gmail because it's the path of least resistance.)
4. **Node 22+ on the cron box** (you'll install Claude Code via npm).

---

## Step 1 — Install Claude Code and `msmtp` on the cron box

```bash
ssh you@cron-box

# Claude Code
sudo npm install -g @anthropic-ai/claude-code

# msmtp for sending mail
sudo apt-get install -y msmtp msmtp-mta ca-certificates
```

**Gotcha:** depending on your npm config, the global install may land at `/usr/lib/node_modules/@anthropic-ai/` with mode `750 root:root`, which blocks every user but root from executing `claude`. If `claude --version` returns "command not found" after the install, fix the perms:

```bash
sudo chmod -R a+rX /usr/lib/node_modules/@anthropic-ai/
which claude && claude --version    # should print 2.x.x
```

---

## Step 2 — Log into Claude Code (once, interactively)

```bash
claude /login
```

This prints a URL — open it in a browser, paste the code back, done. Credentials are stored in `~/.claude/` and headless `claude -p` calls afterwards use them. You don't need to stay logged in after this step.

---

## Step 3 — Register the Slack MCP server with Claude

```bash
claude mcp add --transport http --scope user slack http://YOUR_GATEWAY_HOST:3232/mcp
claude mcp list   # should show: slack: ... ✓ Connected
```

The `--scope user` flag writes to `~/.claude.json` so headless invocations pick it up.

---

## Step 4 — Configure `msmtp` with the Gmail app password

```bash
cat > ~/.msmtprc <<'EOF'
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        ~/.msmtp.log

account        default
host           smtp.gmail.com
port           587
from           YOU@gmail.com
user           YOU@gmail.com
password       YOUR_GMAIL_APP_PASSWORD
EOF

chmod 600 ~/.msmtprc
```

Quick smoke test:

```bash
printf 'To: YOU@gmail.com\nFrom: YOU@gmail.com\nSubject: msmtp test\n\nhello.\n' \
  | msmtp -a default YOU@gmail.com
```

Check your inbox; if it lands, you're good.

---

## Step 5 — The digest script

```bash
mkdir -p ~/bin
cat > ~/bin/slack-digest.sh <<'SCRIPT'
#!/bin/bash
set -uo pipefail

EMAIL_TO="YOU@gmail.com"
EMAIL_FROM="YOU@gmail.com"
TODAY=$(date "+%a %b %-d, %Y")
SUBJECT="Slack Digest — $TODAY"
LOG=/tmp/slack-digest.log

PROMPT=$(cat <<'PROMPT'
You are generating a daily Slack digest for me.

Use the slack MCP tools to gather context:
1. Call mcp__slack__conversations_unreads (mentions_only=false) for DMs/@-mentions.
2. Call mcp__slack__conversations_history (limit=1d) for these channels (skip silent ones):
   #general, #engineering, #announcements
   (replace with the channels you actually care about)

OUTPUT FORMAT — emit HTML body fragments only. NO <html>, <head>, <body>, <style>, or code fences. Just the inner HTML the email template will wrap.

Use exactly this structure:

<div class="priority">
<h2>Priority</h2>
<p>One paragraph: any DMs, @-mentions, or direct asks. If none, write "Nothing direct today."</p>
</div>

<h2>By Channel</h2>

<h3>#channel-name</h3>
<p>1-3 sentences on what happened: decisions, blockers, deadlines, links. Mention humans by first name. Drop in <a href="URL">link text</a> for any URLs shared.</p>

(Repeat the h3+p block for each channel with real activity. SKIP silent channels.)

<div class="action">
<h2>Action Items</h2>
<p>What I should respond to or follow up on today. If none, write "None."</p>
</div>

Total length under 600 words. Plain prose inside <p> tags. No emoji.
PROMPT
)

HTML_BODY=$(claude -p \
  --permission-mode bypassPermissions \
  --allowedTools "mcp__slack" \
  --output-format text \
  "$PROMPT" 2>>"$LOG") || {
  HTML_BODY="<p>Digest generation failed. See $LOG.</p>"
}

{
cat <<HEADERS
To: $EMAIL_TO
From: Digest <$EMAIL_FROM>
Subject: $SUBJECT
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

HEADERS
cat <<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.55; background: #ffffff; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; letter-spacing: 0.02em; text-transform: uppercase; }
  h2 { color: #111827; font-size: 16px; font-weight: 600; margin: 28px 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  h3 { color: #2563eb; font-size: 14px; font-weight: 600; margin: 18px 0 4px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  p { margin: 6px 0; font-size: 14px; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .priority { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 8px 0 24px 0; }
  .priority h2 { margin-top: 0; border-bottom: none; color: #92400e; }
  .action { background: #f0fdf4; border-left: 3px solid #10b981; padding: 12px 16px; border-radius: 4px; margin: 24px 0 8px 0; }
  .action h2 { margin-top: 0; border-bottom: none; color: #065f46; }
</style>
</head>
<body>
<div class="meta">Slack Digest · $TODAY</div>
$HTML_BODY
</body>
</html>
HTML
} | msmtp -a default "$EMAIL_TO"
SCRIPT

chmod +x ~/bin/slack-digest.sh
```

Replace the channel list inside the prompt with whatever channels you actually care about.

Test it end-to-end:

```bash
~/bin/slack-digest.sh
# check your inbox
```

If the email shows up with real content, the pipeline is wired correctly. If not, check `~/.msmtp.log` and `/tmp/slack-digest.log`.

---

## Step 6 — Install the systemd units

```bash
sudo tee /etc/systemd/system/slack-digest.service > /dev/null <<EOF
[Unit]
Description=Daily Slack digest email
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
Group=$USER
WorkingDirectory=$HOME
ExecStart=$HOME/bin/slack-digest.sh
StandardOutput=journal
StandardError=journal
EOF

sudo tee /etc/systemd/system/slack-digest.timer > /dev/null <<'EOF'
[Unit]
Description=Run Slack digest daily at 8am local
Requires=slack-digest.service

[Timer]
OnCalendar=*-*-* 08:00:00 America/Denver
Persistent=true
Unit=slack-digest.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now slack-digest.timer
sudo systemctl list-timers slack-digest.timer --no-pager
```

Swap `America/Denver` for your timezone. The `OnCalendar` expression respects DST automatically — no manual UTC math needed.

---

## Operations

| Action                       | Command                                           |
| ---------------------------- | ------------------------------------------------- |
| Manually fire the digest now | `sudo systemctl start slack-digest.service`       |
| Tail the last run's logs     | `journalctl -u slack-digest.service -n 100`       |
| Check upcoming runs          | `systemctl list-timers slack-digest.timer`        |
| Disable                      | `sudo systemctl disable --now slack-digest.timer` |
| See claude stderr            | `cat /tmp/slack-digest.log`                       |
| See msmtp send log           | `cat ~/.msmtp.log`                                |

---

## Gotchas

- **`Persistent=true` fires once on first enable.** If you enable the timer after the day's scheduled time has already passed, systemd will run the service immediately to catch up. Expect one extra email on day zero. After that it behaves normally.
- **Slack MCP tools must be allow-listed in headless mode.** The `--allowedTools "mcp__slack"` flag is what lets `claude -p` use them without an interactive permission prompt. Without it, the script will hang waiting for input that never comes.
- **The Slack server has to be reachable at run time.** If your gateway is on a different box, make sure that box stays up. The cron box and the gateway box can be the same machine if you prefer.
- **Don't commit `.msmtprc`.** It contains the Gmail app password in plain text. The `chmod 600` is the only thing keeping it private.

---

## Variations

The pattern (`systemd timer → claude -p → MCP → action`) is general. Swap the prompt and the allow-list and you can build:

- **Weekly retro digest** — same script, change the timer to `OnCalendar=Fri 16:00 *-*-*` and change the prompt's `limit=1d` to `limit=1w`.
- **Mention-only urgent-alert poller** — run every two hours; prompt asks only for `mcp__slack__conversations_unreads` with `mentions_only=true`; send email only if the result is non-empty (wrap the script in an `if [ -n "$HTML_BODY" ]`).
- **Multi-source morning brief** — add `mcp__gmail` and `mcp__google-calendar` to the allow-list; expand the prompt to "summarize today's calendar, last 24h unread email, and Slack digest in one note."
- **Linear ticket digest** — point at this hub's Linear server instead of Slack; prompt asks "what moved overnight on tickets assigned to me or where I'm a subscriber."
- **Scheduled outbound Slack post** — `mcp__slack__conversations_add_message` works in headless mode too. Useful for end-of-day status posts to a channel.

The point isn't this specific script — it's that `claude -p` with MCP access is a reusable primitive for "scheduled task that needs to reason about live data and then do something."
