import { toast } from "../components/ui";
import { trash } from "../db/trash";
import type { Member } from "../db/repo";
import { can } from "./permissions";

/**
 * Runs a delete that puts its rows in the trash, then shows a toast with
 * "Urungkan" (undo). Returns false (after an error toast) when it failed.
 */
export async function deleteWithUndo(action: () => Promise<string | void>, text: string, actor: Member): Promise<boolean> {
  try {
    const trashId = await action();
    if (!trashId) {
      toast(text);
      return true;
    }
    toast(text, "ok", {
      label: "Urungkan",
      run: async () => {
        await trash.restore(trashId, { id: actor.id, dompet_id: actor.dompet_id, canManage: can.manage(actor.role) });
        toast("Dipulihkan ↩️");
      },
    });
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return false;
  }
}
