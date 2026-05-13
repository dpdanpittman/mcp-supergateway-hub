# slack (korotovsky/slack-mcp-server)

User-token Slack MCP server. Uses browser session tokens (`xoxc` + `xoxd`)
instead of a bot token — no Slack app install / admin approval required.

- Image: `ghcr.io/korotovsky/slack-mcp-server:latest`
- Namespace: `mcp`
- Port: `3232` on host `192.168.1.176` (hostNetwork)
- Endpoint: `http://192.168.1.176:3232/mcp`

## Tokens

Tokens live in the `slack-mcp-tokens` Secret in the `mcp` namespace.
Source-of-truth on the workstation: `~/.config/slack-mcp/.env` (chmod 600).

To (re)create the Secret from the local `.env`:

```bash
ssh claude@192.168.1.6 "sudo kubectl --kubeconfig=/etc/kubernetes/admin.conf \
  -n mcp create secret generic slack-mcp-tokens \
  --from-env-file=/tmp/slack-mcp.env \
  --dry-run=client -o yaml | sudo kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f -"
```

(Copy the `.env` to the control node's `/tmp/slack-mcp.env` first, then
delete it after the Secret applies.)

## Token rotation

Slack browser tokens are tied to the active session. They invalidate when:

- You log out of Slack (any client).
- Slack expires the session (~weeks of inactivity).
- You change your password.

Re-extract from DevTools (Local Storage `localConfig_v2` → `.token` for
`xoxc-...`; cookie `d` for `xoxd-...`), update `~/.config/slack-mcp/.env`,
re-apply the Secret, restart the pod.

## Posting messages

`SLACK_MCP_ADD_MESSAGE_TOOL=true` exposes `conversations_add_message`. Without
it, only read tools are exposed. Be deliberate about who/what can invoke it.

## Why a dedicated pod, not the gateway

korotovsky ships as a Go binary in a Docker image (not npm), and it speaks
HTTP/SSE natively. Running it through the supergateway proxy would mean
docker-in-pod or a custom gateway image. Cleaner to run it standalone.
