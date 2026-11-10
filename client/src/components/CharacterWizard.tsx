import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 三張照片建立角色：一張臉部正面、兩張全身。
// 照片依序成為角色圖庫的前三張（生成時最優先參考臉部那張）。
// 建立前必須確認照片是本人或已取得同意 —— 這個功能不能拿來做別人的角色。

type SlotId = "face" | "body1" | "body2";
const SLOTS: Array<{ id: SlotId; title: string; hint: string; icon: string }> = [
  { id: "face", title: "臉部正面", hint: "正面、光線充足、五官清楚，不要戴墨鏡或口罩", icon: "fa-face-smile" },
  { id: "body1", title: "全身照 1", hint: "正面站姿，從頭到腳都入鏡", icon: "fa-person" },
  { id: "body2", title: "全身照 2", hint: "側身或不同姿勢，穿著最好相同", icon: "fa-person-walking" },
];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("上傳失敗");
  const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
  const { objectPath } = await pathRes.json();
  return objectPath as string;
}

export function CharacterWizard({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<SlotId>("face");
  const [photos, setPhotos] = useState<Partial<Record<SlotId, string>>>({});
  const [uploading, setUploading] = useState<SlotId | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

  const filled = SLOTS.filter(s => !!photos[s.id]).length;
  const ready = !!photos.face && filled >= 1 && name.trim().length > 0 && consent;

  const pick = (slot: SlotId) => { setTarget(slot); inputRef.current?.click(); };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) {
      toast({ title: "無法使用這個檔案", description: "請上傳 20MB 以內的 JPG、PNG 或 WEBP。", variant: "destructive" });
      return;
    }
    setUploading(target);
    try {
      const path = await uploadToObjectStorage(file);
      setPhotos(prev => ({ ...prev, [target]: path }));
    } catch {
      toast({ title: "上傳失敗", description: "請再試一次。", variant: "destructive" });
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const refImageUrls = SLOTS.map(s => photos[s.id]).filter((u): u is string => !!u);
      const res = await apiRequest("POST", "/api/character-library", { name: name.trim(), refImageUrls, styleHint: "realistic" });
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: "角色已建立", description: "接著替這個角色生成九宮格定裝圖，之後出圖會更穩定。" });
      onClose();
      navigate(`/character-library/sheet?character=${c.id}`);
    },
    onError: () => toast({ title: "建立失敗", description: "請稍後再試。", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-lg max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="character-wizard">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">三張照片建立角色</h3>
            <p className="text-sm text-slate-500 mt-1">一張臉、兩張全身。不需要訓練，建好就能用來生成。</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label="關閉">×</button>
        </div>

        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => onFile(e.target.files?.[0])} data-testid="input-wizard-file" />
        <div className="grid grid-cols-3 gap-3 mt-4">
          {SLOTS.map(s => (
            <button key={s.id} onClick={() => pick(s.id)} disabled={!!uploading}
              className={`relative rounded-2xl border-2 overflow-hidden text-center ${photos[s.id] ? "border-indigo-500" : "border-dashed border-slate-300 hover:border-indigo-400"} disabled:opacity-60`}
              style={{ aspectRatio: "3 / 4" }} data-testid={`wizard-slot-${s.id}`}>
              {photos[s.id] ? (
                <img src={photos[s.id]} alt={s.title} className="w-full h-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400 px-2">
                  <i className={`fas ${uploading === s.id ? "fa-spinner fa-spin" : s.icon} text-xl`} />
                  <span className="text-xs font-medium text-slate-600">{s.title}</span>
                </span>
              )}
              {photos[s.id] && <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] py-0.5">{s.title}・點擊更換</span>}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-1">
          {SLOTS.map(s => <li key={s.id} className="text-[11px] text-slate-500"><b className="text-slate-700">{s.title}</b>：{s.hint}</li>)}
        </ul>

        <label className="block mt-4">
          <span className="text-xs text-slate-600">角色名稱</span>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder="例如：小雨"
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-wizard-name" />
        </label>

        <label className="flex items-start gap-2 mt-4 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-indigo-600" data-testid="checkbox-wizard-consent" />
          <span>我確認這些照片是我本人，或已取得照片中當事人的明確同意，並且當事人已成年。</span>
        </label>

        <button onClick={() => createMutation.mutate()} disabled={!ready || createMutation.isPending || !!uploading}
          className="mt-4 w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-wizard-create">
          {createMutation.isPending ? "建立中…" : "建立角色"}
        </button>
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          {!photos.face ? "至少需要一張臉部正面照。" : filled < 3 ? `已上傳 ${filled}／3 張，三張都放效果最好。` : "照片只有你自己看得到。"}
        </p>
      </div>
    </div>
  );
}
