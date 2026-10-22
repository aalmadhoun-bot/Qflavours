import { clearCookie, json } from "../auth.js";

export const onRequestPost = () => json({ ok: true }, 200, { "set-cookie": clearCookie });
