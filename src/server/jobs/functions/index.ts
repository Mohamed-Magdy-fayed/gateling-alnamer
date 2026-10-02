import { ping } from "./ping";
import { sendCodeEmail } from "./send-code-email";
import { sendEmail } from "./send-email";

export const functions = [sendEmail, sendCodeEmail, ping];
