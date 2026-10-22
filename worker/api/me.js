import { json, publicUser } from "../auth.js";

export const onRequestGet = ({ data }) => json(publicUser(data.user));
