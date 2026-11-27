"use client";

import { useEffect, useRef, useState } from "react";
import CrmModal from "@/components/crm/CrmModal";

export default function BarcodeCamera({ onCode, onClose }: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onCode, onClose });
  const [error, setError] = useState("");
  useEffect(() => { handlers.current = { onCode, onClose }; }, [onCode, onClose]);

  useEffect(() => {
    let finished = false;
    let stream: MediaStream | undefined;
    let controls: { stop(): void } | undefined;
    function stop() {
      finished = true;
      controls?.stop();
      stream?.getTracks().forEach(track => track.stop());
    }
    function onVisibility() {
      if (document.hidden) {
        stop();
        handlers.current.onClose();
      }
    }
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Este navegador no permite abrir la cámara. Escribe el código en el buscador.");
          return;
        }
        const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        if (finished) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        });
        if (finished || !preview.current) { stop(); return; }
        controls = await new BrowserMultiFormatOneDReader().decodeFromStream(stream, preview.current, (result, _, scanner) => {
          if (!result || finished) return;
          finished = true;
          scanner.stop();
          handlers.current.onCode(result.getText());
        });
        if (finished) controls.stop();
      } catch (cause) {
        if (finished) return;
        stop();
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Permite el acceso a la cámara en tu navegador o escribe el código en el buscador."
          : "No se pudo iniciar la cámara. Cierra el escáner y vuelve a intentarlo o escribe el código.");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    void start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  return <CrmModal open title="Escanear código de barras" onClose={onClose} alert={error}>
    {!error && <><video ref={preview} muted playsInline autoPlay aria-label="Vista de la cámara" className="aspect-video w-full rounded-xl bg-black object-contain" />
      <p className="text-sm text-slate-600">Centra un solo código de barras para agregar el producto al carrito.</p></>}
  </CrmModal>;
}
