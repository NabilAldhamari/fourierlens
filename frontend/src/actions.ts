// Opening images: shared by the file picker, drag-and-drop, paste and samples.

import { api, type LoadedImage } from "./api";
import { useApp } from "./store";
import { pixels, viewports } from "./viewport";

async function open(load: () => Promise<LoadedImage>) {
  const { setBusy, setError, setImage, setFindings } = useApp.getState();
  setBusy(true);
  setError(null);
  try {
    const img = await load();
    viewports.image.reset();
    viewports.spectrum.reset();
    setImage(img);
    pixels.load(api.originalUrl(img.id)).catch(() => undefined);
    api
      .findings(img.id)
      .then((f) => useApp.getState().image?.id === img.id && setFindings(f))
      .catch((e) => setError(`Automatic checks failed: ${e.message}`));
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setBusy(false);
  }
}

export const openFile = (file: File) => open(() => api.upload(file));
export const openSample = (name: string) => open(() => api.loadSample(name));

export function imageFileFrom(list: FileList | null | undefined): File | null {
  if (!list) return null;
  for (const f of Array.from(list)) if (f.type.startsWith("image/") || /\.(tiff?|webp)$/i.test(f.name)) return f;
  return null;
}
