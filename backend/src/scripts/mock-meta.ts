// Mock local de la Meta WhatsApp Cloud API para probar el flujo de envío
// sin credenciales reales. Apuntar META_GRAPH_BASE_URL=http://localhost:4999/v20.0
// y correr: npx tsx src/scripts/mock-meta.ts
//
// Comportamiento: acepta cualquier POST .../messages y devuelve un wamid falso.
// Los números terminados en "4001" simulan "número inválido" (código 131026,
// no reintentable) para probar el camino de ERROR.
import http from "http";

const PORT = 4999;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST" && /\/messages$/.test(req.url ?? "")) {
        const data = JSON.parse(body || "{}");
        const to: string = data.to ?? "";
        console.log(
          `[mock-meta] ${data.type} a ${to}` +
            (data.template ? ` (template ${data.template.name}, vars: ${JSON.stringify(data.template.components?.[0]?.parameters?.map((p: any) => p.text))})` : "")
        );

        if (to.endsWith("4001")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "(#131026) Message undeliverable", type: "OAuthException", code: 131026 },
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            messaging_product: "whatsapp",
            contacts: [{ input: to, wa_id: to.replace("+", "") }],
            messages: [{ id: `wamid.MOCK.${Math.random().toString(36).slice(2)}` }],
          })
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`Mock de Meta Cloud API escuchando en :${PORT}`));
