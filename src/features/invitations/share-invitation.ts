export type InvitationShareOutcome = "shared" | "copied" | "cancelled" | "failed";

async function copyInvitationLink(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Try the selection-based fallback below when clipboard permission is denied.
  }

  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

export async function shareInvitationLink(url: string): Promise<InvitationShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share({ title: "یه سورپرایز کوچولو برات دارم", text: "یه دعوت کوچولو برای باهم‌بودن", url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }

  return (await copyInvitationLink(url)) ? "copied" : "failed";
}
