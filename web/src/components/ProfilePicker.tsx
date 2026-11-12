import type { Member } from "../db/repo";
import { ROLE_LABEL } from "../lib/permissions";
import { setSession } from "../lib/session";
import { Avatar } from "./ui";

/** Full-screen "Siapa yang lagi pakai?" chooser, like picking a profile on a shared TV. */
export function ProfilePicker({
  dompetName,
  members,
  currentId,
  onClose,
}: {
  dompetName: string;
  members: Member[];
  currentId?: string;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#fff8f1] px-6 py-10" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,#ffe0d1_0,transparent_45%),radial-gradient(circle_at_85%_90%,#fff1bd_0,transparent_40%)]" />
      <div className="pop-in relative w-full max-w-lg text-center">
        <p className="text-sm font-semibold text-brand-700">{dompetName}</p>
        <h1 id="picker-title" className="mt-1 text-3xl font-extrabold tracking-tight text-slate-800">
          Siapa yang lagi pakai?
        </h1>
        <p className="mt-2 text-slate-500">Pilih dirimu supaya keluarga tahu siapa yang mencatat.</p>

        <ul className="mt-8 flex flex-wrap justify-center gap-3">
          {members.map((m) => (
            <li key={m.id} className="w-32 sm:w-36">
              <button
                onClick={() => {
                  setSession({ memberId: m.id }, { picked: true });
                  onClose?.();
                }}
                className="group flex w-full flex-col items-center gap-2 rounded-3xl p-3 transition hover:bg-white hover:shadow-[0_8px_24px_-12px_rgba(120,72,40,0.3)] focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <span className="transition group-hover:-translate-y-1">
                  <Avatar emoji={m.emoji} colour={m.colour} size={84} />
                </span>
                <span className="text-lg font-bold text-slate-800">
                  {m.name}
                  {m.id === currentId && <span className="ml-1 text-sm font-semibold text-brand-600">✓</span>}
                </span>
                <span className="-mt-1 text-xs font-medium text-slate-500">{ROLE_LABEL[m.role]}</span>
              </button>
            </li>
          ))}
        </ul>

        {onClose && (
          <button onClick={onClose} className="mt-8 text-sm font-semibold text-slate-500 underline-offset-4 hover:underline">
            Batal
          </button>
        )}
      </div>
    </div>
  );
}
