"use client";

// "없어요"를 고르면 나머지가 풀리고, 다른 걸 고르면 "없어요"가 풀리는 칩
export function ExclusiveChips({ name, options, checked = [], none = "없어요" }: {
  name: string; options: readonly string[]; checked?: string[]; none?: string;
}) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const box = e.currentTarget.closest("[data-chips]");
    if (!box || !e.currentTarget.checked) return;
    box.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((el) => {
      if (el === e.currentTarget) return;
      if (e.currentTarget.value === none || el.value === none) el.checked = false;
    });
  }
  return (
    <div data-chips className="flex flex-wrap gap-2">
      {[none, ...options].map((o) => (
        <label key={o} className="cursor-pointer">
          <input type="checkbox" name={name} value={o} defaultChecked={checked.includes(o)} onChange={onChange} className="peer sr-only" />
          <span className={`inline-block rounded-full border px-3 py-1.5 text-sm peer-checked:border-[#7A1F2B] peer-checked:bg-[#7A1F2B] peer-checked:text-white ${o === none ? "border-dashed border-[#C9B8B3] bg-white" : "border-[#E9DCD3] bg-[#FFFCF9]"}`}>
            {o}
          </span>
        </label>
      ))}
    </div>
  );
}
