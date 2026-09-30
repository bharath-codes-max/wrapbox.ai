// Employee onboarding (placeholder; being built).
export function EmployeeOnboarding({ nav }: { nav: (r: string) => void }) {
  return <div className="page"><div className="card"><button className="btn" onClick={() => nav("start")}>Back</button></div></div>;
}
