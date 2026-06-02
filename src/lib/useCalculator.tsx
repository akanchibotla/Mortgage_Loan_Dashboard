import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const DEFAULT_LOAN = 350_000;

interface CalculatorState {
  loanAmount: number;
  setLoanAmount: Dispatch<SetStateAction<number>>;
  rateText: string;
  setRateText: Dispatch<SetStateAction<string>>;
}

const CalculatorContext = createContext<CalculatorState | undefined>(undefined);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [loanAmount, setLoanAmount] = useState<number>(DEFAULT_LOAN);
  const [rateText, setRateText] = useState<string>("");
  return (
    <CalculatorContext.Provider value={{ loanAmount, setLoanAmount, rateText, setRateText }}>
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculator(): CalculatorState {
  const ctx = useContext(CalculatorContext);
  if (!ctx) {
    throw new Error("useCalculator must be used inside <CalculatorProvider>");
  }
  return ctx;
}
