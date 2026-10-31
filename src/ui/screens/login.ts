/**
 * Login screen — shown at app start. Three ways in:
 *   • Google / email account → cloud backup, rankings, friends
 *   • Guest mode → rep counting works fully, internet features stay off
 */

import type { Ctx } from "../../app";
import { t } from "../../i18n/i18n";
import { icons } from "../icons";
import { signInWithGoogle, signIn, signUp, resetPassword, onAuthChange, setGuest } from "../../services/cloud";
import { log } from "../../services/logger";

export function renderLogin(root: HTMLElement, ctx: Ctx, onDone: () => void) {
  root.innerHTML = `
    <div class="screen no-nav" style="display:flex;flex-direction:column;justify-content:center;min-height:92vh">
      <div class="center-col" style="margin-bottom:30px">
        <div class="logo-mark" style="margin-bottom:14px">${icons.dumbbell}</div>
        <div class="h-display">RepCoun</div>
        <div class="sub" style="margin-top:8px">${t("app.tagline")}</div>
      </div>
      <button class="btn lg block" data-a="google" style="background:#fff;color:#1f1f1f;display:flex;align-items:center;justify-content:center;gap:10px">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </button>
      <button class="btn soft lg block" style="margin-top:10px" data-a="signin">${t("profile.sign_in")}</button>
      <button class="btn soft lg block" style="margin-top:10px" data-a="signup">${t("profile.create_account")}</button>
      <button class="btn ghost block" style="margin-top:16px" data-a="guest">${t("profile.guest")}</button>
      <div class="tiny" id="login-msg" style="margin-top:14px;text-align:center"></div>
      <div class="tiny" style="margin-top:8px;text-align:center;opacity:.65">${t("profile.guest_note")}</div>
    </div>`;

  const msg = root.querySelector("#login-msg") as HTMLElement;

  // If a session restores in the background (signed in before), just proceed.
  const off = onAuthChange((email) => {
    if (email) {
      off();
      log.i("auth", "restored session — entering app");
      onDone();
    }
  });

  root.querySelector('[data-a="guest"]')!.addEventListener("click", () => {
    log.i("auth", "guest mode");
    setGuest(true);
    onDone();
  });

  root.querySelector('[data-a="google"]')!.addEventListener("click", async () => {
    msg.textContent = "…";
    log.i("auth", "google sign-in tapped");
    const err = await signInWithGoogle();
    if (err) {
      log.e("auth", `google FAIL ${err}`);
      msg.textContent = err;
      return;
    }
    log.i("auth", "google sign-in ok");
    onDone();
  });

  root.querySelector('[data-a="signin"]')!.addEventListener("click", () => authSheet(ctx, false, onDone));
  root.querySelector('[data-a="signup"]')!.addEventListener("click", () => authSheet(ctx, true, onDone));
}

function authSheet(ctx: Ctx, register: boolean, onDone: () => void) {
  ctx.openSheet(
    `<div class="h2" style="margin-bottom:12px">${register ? t("profile.create_account") : t("profile.sign_in")}</div>
     <input class="input" id="acc-mail" placeholder="email">
     <input class="input" id="acc-pass" type="password" style="margin-top:10px" placeholder="password (min 6 characters)">
     <button class="btn primary block" style="margin-top:14px" data-a="go">${register ? t("profile.create_account") : t("profile.sign_in")}</button>
     ${register ? "" : `<button class="btn ghost block" style="margin-top:10px" data-a="forgot">Forgot password?</button>`}
     <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
     <div class="tiny" id="acc-msg" style="margin-top:10px;text-align:center"></div>`,
    (sheet, closeFn) => {
      sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
      sheet.querySelector('[data-a="forgot"]')?.addEventListener("click", async () => {
        const out = sheet.querySelector("#acc-msg") as HTMLElement;
        const mail = (sheet.querySelector("#acc-mail") as HTMLInputElement).value.trim();
        if (!mail) {
          out.textContent = "type your email first";
          return;
        }
        out.textContent = "…";
        log.i("auth", `password reset ${mail}`);
        const err = await resetPassword(mail);
        out.textContent = err ?? "reset email sent — check your inbox";
      });
      sheet.querySelector('[data-a="go"]')!.addEventListener("click", async () => {
        const out = sheet.querySelector("#acc-msg") as HTMLElement;
        const mail = (sheet.querySelector("#acc-mail") as HTMLInputElement).value.trim();
        const pass = (sheet.querySelector("#acc-pass") as HTMLInputElement).value;
        if (!mail || pass.length < 6) {
          out.textContent = "enter email and a password of 6+ characters";
          return;
        }
        out.textContent = "…";
        log.i("auth", `${register ? "sign-up" : "sign-in"} ${mail}`);
        const err = register ? await signUp(mail, pass) : await signIn(mail, pass);
        if (err) {
          log.e("auth", `FAIL ${err}`);
          out.textContent = err;
          return;
        }
        log.i("auth", "ok");
        closeFn();
        onDone();
      });
    }
  );
}

