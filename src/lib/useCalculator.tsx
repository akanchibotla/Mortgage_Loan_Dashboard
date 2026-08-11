import {
  createContext,
  useCallback,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const DEFAULT_LOAN = 350_000;

// The one agreed range for the SHARED loan amount, per commit ad0259cf.
// Every page that writes loanAmount used to enforce its own bound — the
// state dashboard had none at all, so a $1,000,000,000,000 typed there
// followed this context onto the home page whose input advertises a $5M
// max. The floor stays 0 deliberately: these are controlled inputs, and a
// non-zero floor snaps the field mid-keystroke while the user is still
// typing the first digits of a real amount.
export const LOAN_MIN = 0;
export const LOAN_MAX = 3_000_000;

// Same argument for the shared rate text. Both writers clamp on BLUR (never
// per-keystroke — "-" and "6." are legal intermediate states in a controlled
// field), so these bounds have to agree or the two pages disagree about what
// the shared value means.
export const RATE_MIN = 0.5;
export const RATE_MAX = 25;

export function clampLoanAmount(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_LOAN;
  return Math.max(LOAN_MIN, Math.min(LOAN_MAX, v));
}

interface CalculatorState {
  loanAmount: number;
  setLoanAmount: Dispatch<SetStateAction<number>>;
  rateText: string;
  setRateText: Dispatch<SetStateAction<string>>;
}

const CalculatorContext = createContext<CalculatorState | undefined>(undefined);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [loanAmount, setLoanAmountRaw] = useState<number>(DEFAULT_LOAN);
  const [rateText, setRateText] = useState<string>("");
  // Clamp HERE rather than trusting each caller: this is the only place all
  // three writers funnel through, so it is the only place the bound cannot
  // be forgotten. Supports the updater form because HomePage's steppers use
  // it.
  const setLoanAmount = useCallback<Dispatch<SetStateAction<number>>>((action) => {
    setLoanAmountRaw((prev) =>
      clampLoanAmount(typeof action === "function" ? action(prev) : action),
    );
  }, []);
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
