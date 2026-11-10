import { Fragment } from "react";

/**
 * An email address that, when it must wrap, wraps after the `@` rather than mid-word.
 * `break-words` alone split `ana.martinez@gmail.com` as `ana.martinez@g` / `mail.com` on a
 * 390px phone. A `<wbr>` is an opportunity, not a character, so copying the address still
 * copies it whole (a zero-width space would not).
 */
export function BreakableEmail({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at < 0) return <>{email}</>;
  return (
    <Fragment>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </Fragment>
  );
}
