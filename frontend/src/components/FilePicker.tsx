import { useRef } from "react";
import { imageFileFrom, openFile } from "../actions";

/** Hidden file input plus a function that opens the system file dialog. */
export function useFilePicker() {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*,.tif,.tiff"
      hidden
      onChange={(e) => {
        const f = imageFileFrom(e.target.files);
        if (f) openFile(f);
        e.target.value = "";
      }}
    />
  );
  return { input, choose: () => ref.current?.click() };
}
