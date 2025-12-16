import { createContext, useContext, useMemo, useState } from "react";

type CanvasContextType = {
  isCanvasOpen: boolean;
  setCanvasOpen: (open: boolean) => void;
  openCanvas: () => void;
  closeCanvas: () => void;
};

const CanvasContext = createContext<CanvasContextType | undefined>(undefined);

export const CanvasProvider = ({ children }: { children: React.ReactNode }) => {
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);

  const value = useMemo<CanvasContextType>(
    () => ({
      isCanvasOpen,
      setCanvasOpen: setIsCanvasOpen,
      openCanvas: () => setIsCanvasOpen(true),
      closeCanvas: () => setIsCanvasOpen(false),
    }),
    [isCanvasOpen],
  );

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
};

export const useCanvas = () => {
  const context = useContext(CanvasContext);
  if (context === undefined) {
    throw new Error("useCanvas must be used within a CanvasProvider");
  }
  return context;
};
