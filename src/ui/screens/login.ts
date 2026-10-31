/**
 * Login screen — shown at app start. Three ways in:
 *   • Google / email account → cloud backup, rankings, friends
 *   • Guest mode → rep counting works fully, internet features stay off
 */

import type { Ctx } from "../../app";
import { t } from "../../i18n/i18n";
import { icons } from "../icons";
import { signInWithGoogle, signIn, signUp, onAuthChange, setGuest } from "../../services/cloud";
import { log } from "../../services/logger";

export function renderLogin(root: HTMLElement, ctx: Ctx, onDone: () => void) {
  root.innerHTML = `
    <div class="screen no-nav" style="display:flex;flex-direction:column;justify-content:center;min-height:92vh">
      <div class="center-col" style="margin-bottom:30px">
        <div class="logo-mark" style="margin-bottom:14px">${icons.dumbbell}</div>
        <div class="h-display">RepCoun</div>
        <div class="sub" style="margin-top:8px">${t("app.tagline")}</div>
      </div>
      <button class="btn primary lg block" data-a="google">Continue with Google</button>
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
     <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
     <div class="tiny" id="acc-msg" style="margin-top:10px;text-align:center"></div>`,
    (sheet, closeFn) => {
      sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
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

