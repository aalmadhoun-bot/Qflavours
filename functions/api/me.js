import { json, publicUser } from "../../lib/auth.js";

export const onRequestGet = ({ data }) => json(publicUser(data.user));
