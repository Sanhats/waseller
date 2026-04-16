import express from "express";
import QRCode from "qrcode";
import { BaileysSessionManager, getResolvedWaAuthDir } from "./session-manager/baileys-session-manager";

const app = express();
app.use(express.json());

const manager = new BaileysSessionManager();

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: manager.list().length });
});

app.get("/sessions", (_req, res) => {
  res.json(manager.list());
});

app.post("/sessions/connect", async (req, res) => {
  const { tenantId, whatsappNumber } = req.body as { tenantId?: string; whatsappNumber?: string };
  if (!tenantId || !whatsappNumber) {
    res.status(400).json({ message: "tenantId and whatsappNumber are required" });
    return;
  }

  const snapshot = await manager.connect({ tenantId, whatsappNumber });
  res.json(snapshot);
});

app.get("/sessions/qr.png", async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const whatsappNumber = req.query.whatsappNumber as string | undefined;
  if (!tenantId || !whatsappNumber) {
    res.status(400).json({ message: "tenantId and whatsappNumber are required" });
    return;
  }

  const session = manager.getSession(tenantId, whatsappNumber);
  if (!session) {
    res.status(404).json({ message: "Session not found" });
    return;
  }
  if (!session.qr) {
    res.status(409).json({ message: "QR not available", status: session.status });
    return;
  }

  const pngBuffer = await QRCode.toBuffer(session.qr, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360
  });

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(pngBuffer);
});

app.get("/contacts/:phone/profile-picture", async (req, res) => {
  const { tenantId } = req.query as { tenantId?: string };
  const { phone } = req.params;
  
  if (!tenantId || !phone) {
    res.status(400).json({ message: "tenantId query parameter and phone are required" });
    return;
  }

  try {
    const result = await manager.getProfilePicture(tenantId, phone);
    res.json(result);
  } catch (error) {
    res.status(409).json({
      message: error instanceof Error ? error.message : "Unable to get profile picture"
    });
  }
});

app.post("/send", async (req, res) => {
  const { tenantId, phone, message, imageUrl } = req.body as {
    tenantId?: string;
    phone?: string;
    message?: string;
    imageUrl?: string;
  };
  if (!tenantId || !phone || !message) {
    res.status(400).json({ message: "tenantId, phone and message are required" });
    return;
  }

  try {
    const result = await manager.sendMessage(tenantId, phone, message, imageUrl);
    res.json(result);
  } catch (error) {
    res.status(409).json({
      message: error instanceof Error ? error.message : "Unable to send WhatsApp message"
    });
  }
});

const port = Number(process.env.PORT ?? process.env.WHATSAPP_PORT ?? 3100);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WhatsApp service listening on ${port} (WA_AUTH_DIR=${getResolvedWaAuthDir()})`);
});
