import { AVATAR_INVALID_MESSAGE, type AvatarMime, isAvatarUpload, type UserAvatar } from "@receivy/common";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as ImagePicker from "expo-image-picker";
import type { AccountClient } from "./client";

/** Must be called directly from a user-triggered action. Resolves with the new photo, or null when nothing was picked. */
export async function pickAndUploadAvatar(client: Pick<AccountClient, "startAvatarUpload" | "completeAvatarUpload">): Promise<UserAvatar | null> {
  // `aspect` only applies on Android; the iOS editor is always square.
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];

  if (!asset) {
    return null;
  }

  const file = new File(asset.uri);
  const size = asset.fileSize ?? file.size;

  if (!isAvatarUpload(asset.mimeType, size)) {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  const mime = asset.mimeType as AvatarMime;
  const ticket = await client.startAvatarUpload(mime);
  const response = await expoFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: file });

  if (!response.ok) {
    throw new Error("A foto não foi enviada. Tente novamente.");
  }

  return client.completeAvatarUpload();
}
