import { ping } from "./ping";
import { purgeCodes } from "./purge-codes";
import { sendCodeEmail } from "./send-code-email";
import { sendEmail } from "./send-email";

export const functions = [sendEmail, sendCodeEmail, purgeCodes, ping];
