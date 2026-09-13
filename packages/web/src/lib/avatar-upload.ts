import { AVATAR_INVALID_MESSAGE, AvatarMime, type AvatarUploadTicket, type UserAvatar } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const EDGE = 512;
const QUALITY = 0.85;

/** Centre-crops the picked image to a square and re-encodes it as a JPEG small enough for the 2 MB limit. */
export async function squareJpeg(file: File, edge = EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");

  canvas.width = edge;
  canvas.height = edge;
  canvas.getContext("2d")?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, AvatarMime.Jpeg, QUALITY));

  if (!blob) {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  return blob;
}

/** Reserve, signed PUT, then complete: the same three steps as a proof upload. */
export async function uploadAvatar(blob: Blob): Promise<UserAvatar> {
  const reserve = await browserFetch("/api/financial/account/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mime: AvatarMime.Jpeg }),
  });

  if (!reserve.ok) {
    throw new Error(await responseMessage(reserve, "Não foi possível trocar a foto."));
  }

  const ticket = (await reserve.json()) as AvatarUploadTicket;
  const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": AvatarMime.Jpeg }, body: blob, credentials: "omit", referrerPolicy: "no-referrer" });

  if (!put.ok) {
    throw new Error("A foto não foi enviada. Tente novamente.");
  }

  const complete = await browserFetch("/api/financial/account/avatar/complete", { method: "POST" });

  if (!complete.ok) {
    throw new Error(await responseMessage(complete, AVATAR_INVALID_MESSAGE));
  }

  return ((await complete.json()) as { avatar: UserAvatar }).avatar;
}
