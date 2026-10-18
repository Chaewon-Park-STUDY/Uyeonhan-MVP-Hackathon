import { Suspense } from "react";
import { connection } from "next/server";
import { supabase } from "@/lib/supabase";

type Slot = {
  id: string;
  starts_at: string;
  region_code: string;
  regions: { name: string } | { name: string }[] | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const regionName = (s: Slot) =>
  Array.isArray(s.regions) ? s.regions[0]?.name : s.regions?.name ?? s.region_code;

// 요청 시점에 DB를 읽는 부분 (Suspense 안에서 렌더링)
async function SlotList() {
  await connection();
  const { data, error } = await supabase
    .from("event_slots")
    .select("id, starts_at, region_code, regions(name)")
    .order("starts_at")
    .order("region_code");

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">DB 연결 오류: {error.message}</p>
    );
  }

  const slots = (data ?? []) as Slot[];
  if (slots.length === 0) {
    return <p className="text-sm text-[#7A5E4B]">모집 중인 회차가 없어요.</p>;
  }

  return (
    <ul className="space-y-2">
      {slots.map((s) => (
        <li key={s.id} className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm">
          <span>{fmt(s.starts_at)}</span>
          <span className="rounded-full bg-[#F3E6D6] px-3 py-1 text-sm">{regionName(s)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#FBF6EE] text-[#4A3426] px-4 py-10">
      <div className="mx-auto max-w-md">
        <p className="text-sm tracking-widest text-[#B9784A]">매주 목요일 저녁</p>
        <h1 className="mt-1 text-3xl font-bold">우연한 식탁</h1>
        <p className="mt-2 text-[#7A5E4B]">처음 보는 사람들과 좋은 저녁 한 끼</p>

        <h2 className="mt-10 mb-3 font-semibold">모집 중인 회차</h2>
        <Suspense fallback={<p className="text-sm text-[#7A5E4B]">불러오는 중…</p>}>
          <SlotList />
        </Suspense>
      </div>
    </main>
  );
}