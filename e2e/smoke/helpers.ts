import { type Browser, expect, type Page } from "@playwright/test";
import { nextClientIp } from "../helpers/client-ip";

// Arabic is the default locale; labels below are the `ar` dictionary values.
export const BRAND = "النمر";
export const SIGN_UP = "إنشاء الحساب";
export const SIGN_IN = "دخول";
export const SIGN_OUT = "تسجيل الخروج";
export const SEND_CODE = "إرسال الرمز";
export const SAVE_PASSWORD = "حفظ كلمة المرور";
export const FIELD_EMAIL = "البريد الإلكتروني";
export const FIELD_PASSWORD = "كلمة المرور";
export const FIELD_NAME = "الاسم الكامل";
export const FIELD_CODE = "الرمز";
export const FIELD_NEW_PASSWORD = "كلمة المرور الجديدة";
export const SWITCH_TO_EN = "English";
export const FIELD_USERNAME = "اسم المستخدم (اختياري)";
export const FIELD_IDENTIFIER = "البريد الإلكتروني أو اسم المستخدم";
export const DOB_DAY = "اليوم";
export const DOB_MONTH = "الشهر";
export const DOB_YEAR = "السنة";
export const CONSENT = "أقرّ بأنني حصلت على موافقة ولي أمري على إنشاء هذا الحساب.";
export const PARENT_ROLE = "ولي أمر";
export const PARENT_AGE_ERROR = "حساب ولي الأمر يتطلب تاريخ ميلاد يثبت أن عمرك 18 عامًا أو أكثر.";
export const CAPTCHA_FAILED = "لم نتمكن من التحقق من أنك لست برنامجًا آليًا";
export const CREDENTIALS_ERROR = "البريد أو اسم المستخدم أو كلمة المرور غير صحيحة";
export const LOCKOUT = "تم إيقاف تسجيل الدخول من هذا الجهاز مؤقتًا";
export const VERIFY = "تأكيد";
export const RESEND = "إرسال رمز جديد";
export const CONTINUE = "المتابعة إلى لوحتي";
export const BANNER_ACTION = "تأكيد البريد";
export const BANNER = "أكّد بريدك الإلكتروني قبل شراء أي دورة";
export const VERIFIED = "تم تأكيد بريدك الإلكتروني.";
export const CODE_INVALID = "هذا الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.";
export const CODE_SENT = "إذا كان هناك حساب بهذا البريد، فستصلك رسالة برمز من 6 أرقام خلال دقائق.";
export const VERIFY_TITLE = "تأكيد بريدك الإلكتروني";
export const VERIFIED_TITLE = "تم تأكيد البريد";
export const EMAIL_DELAYED =
  "تأخّر وصول الرسالة. تحقق من مجلد الرسائل غير المرغوب فيها أو أعد الإرسال.";
export const LINK_PARENT = "اربط حساب ولي أمرك ليتابع تقدّمك.";
export const CARDS_TITLE = "أبناؤك";
export const PARENT_EMPTY = "لم تُضِف أيَّ ابن بعد. أنشئ حسابًا لابنك أو أرسل له رمز ربط.";
export const ADD_CHILD = "إنشاء حساب لابن";
export const INVITE_CREATE = "إنشاء رمز ربط";
export const INVITE_COPY = "نسخ الرمز";
export const INVITE_COPIED = "تم نسخ الرمز.";
export const INVITE_ACTIVE_TITLE = "رموز الربط النشطة";
export const FIELD_CHILD_USERNAME = "اسم المستخدم";
export const PROGRESS_PLACEHOLDER = "سيظهر التقدم بعد أول دورة لابنك.";
export const LINK_LABEL = "رمز الربط";
export const LINK_SUBMIT = "ربط الحساب";
export const LINKED = "تم ربط حسابك بولي أمرك.";
export const LINK_INVALID = "هذا الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا من ولي أمرك.";
export const RESET_DIRECT = "تعيين كلمة مرور جديدة";
export const RESET_ACTION = "إعادة تعيين كلمة المرور";
export const RESET_DONE = "تم تعيين كلمة المرور الجديدة.";
export const UNLINK = "إلغاء الربط";
export const CANCEL = "تراجع";
export const CANNOT_PLAY = "حسابات أولياء الأمور لا تشغّل الدروس. يمكنك متابعة تقدم أبنائك من هنا.";

export const runId = Date.now().toString(36);
export const email = `smoke-${runId}@alnamer.local`;
export const password = "Smoke-pass-1";
export const newPassword = "Smoke-pass-2";
export const username = `smoke_${runId}`;
export const parentEmail = `smoke-parent-${runId}@alnamer.local`;
export const verifyEmail = `smoke-verify-${runId}@alnamer.local`;
export const minorEmail = `smoke-minor-${runId}@alnamer.local`;
export const shellEmail = `smoke-shell-${runId}@alnamer.local`;
export const recoveryEmail = `smoke-recovery-${runId}@alnamer.local`;
export const redeemEmail = `smoke-redeem-${runId}@alnamer.local`;
export const SHOW_PASSWORD = "إظهار كلمة المرور";

/** Picks a date in the three DOB selects by option position, so it does not depend on month names. */
export async function pickDate(page: Page, yearsAgo: number, monthIndex: number, dayIndex: number) {
  const year = String(new Date().getFullYear() - yearsAgo);
  await page.getByRole("combobox", { name: DOB_YEAR }).click();
  await page.getByRole("option", { name: year, exact: true }).click();
  await page.getByRole("combobox", { name: DOB_MONTH }).click();
  await page.getByRole("option").nth(monthIndex).click();
  await page.getByRole("combobox", { name: DOB_DAY }).click();
  await page.getByRole("option").nth(dayIndex).click();
}

/** Sign-up now lands on /verify-email; the dashboard is one navigation away (the email stays unverified). */
export async function finishSignUp(page: Page) {
  await page.waitForURL("**/verify-email");
  await page.goto("/dashboard");
}

/** Signs in with the email field (the identifier field accepts an email as well). */
export async function signIn(page: Page, address: string, withPassword: string) {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_EMAIL).fill(address);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(withPassword);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
}

export async function signInAs(page: Page, identifier: string, withPassword: string) {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_IDENTIFIER).fill(identifier);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(withPassword);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
}

export async function startParentSignUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByRole("radio", { name: PARENT_ROLE }).click();
  await expect(page.getByRole("radio", { name: PARENT_ROLE })).toBeChecked();
  await page.getByLabel(FIELD_NAME).fill("Smoke Parent");
  await page.getByLabel(FIELD_EMAIL).fill(parentEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
}

/**
 * Signs an adult student up in a throwaway context (its own client address), so a spec file that
 * needs an account does not depend on another file having run first.
 */
export async function createStudent(
  browser: Browser,
  baseURL: string | undefined,
  account: { name: string; email: string; password: string },
) {
  const context = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    const page = await context.newPage();
    await page.goto("/sign-up");
    await page.getByLabel(FIELD_NAME).fill(account.name);
    await page.getByLabel(FIELD_EMAIL).fill(account.email);
    await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(account.password);
    await pickDate(page, 25, 4, 14);
    await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
    await page.waitForURL("**/verify-email");
  } finally {
    await context.close();
  }
}
