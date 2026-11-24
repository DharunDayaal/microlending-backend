// Supabase Storage access for exports. Uses the service role key, so this file
// must only ever run on the server. Needs: npm i @supabase/supabase-js
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EXPORT_BUCKET,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "../../config/env";

let client: SupabaseClient | null = null;

function storage() {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
    }
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client.storage.from(EXPORT_BUCKET);
}

export async function uploadExportFile(
  filePath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await storage().upload(filePath, body, {
    contentType,
    upsert: true, // a retried job replaces its own half-finished upload
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

/** Short-lived download link. `fileName` becomes the name the phone saves it as. */
export async function signExportUrl(
  filePath: string,
  fileName: string,
  seconds: number,
): Promise<string> {
  const { data, error } = await storage().createSignedUrl(filePath, seconds, {
    download: fileName,
  });
  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign URL: ${error?.message ?? "no url"}`);
  }
  return data.signedUrl;
}

export async function removeExportFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await storage().remove(paths);
  if (error) throw new Error(`Delete failed: ${error.message}`);
}