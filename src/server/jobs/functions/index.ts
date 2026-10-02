import { ping } from "./ping";
import { purgeCodes } from "./purge-codes";
import { sendCodeEmail } from "./send-code-email";
import { sendEmail } from "./send-email";
import { supportRequest } from "./support-request";

export const functions = [sendEmail, sendCodeEmail, supportRequest, purgeCodes, ping];
