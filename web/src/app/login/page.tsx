import { DiamondRule, WaxSeal } from "@/components/brand";
import { Card, ErrorBox, Page, Submit, inputCls } from "@/components/ui";
import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const signup = sp.mode === "signup";
  return (
    <Page>
      <div className="mb-8 mt-4 text-center">
        <span className="inline-block"><WaxSeal size={64} /></span>
        <p className="mt-3 font-serif text-sm tracking-widest text-[#7A1F2B]">{signup ? "초대에 응하기" : "다시 오신 걸 환영해요"}</p>
        <h1 className="mt-1 font-brand text-3xl font-bold text-[#7A1F2B]">우연한 식탁</h1>
        <DiamondRule className="mx-auto mt-3 w-40 text-[#C9A227]" />
        <p className="mt-3 text-[#6A4A4C]">처음 보는 사람들과 좋은 저녁 한 끼</p>
      </div>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">{signup ? "회원가입" : "로그인"}</h2>
        <ErrorBox message={sp.error} />
        <form action={signup ? signUp : signIn} className="space-y-3">
          <input type="hidden" name="next" value={sp.next ?? "/"} />
          {sp.ref && <input type="hidden" name="ref" value={sp.ref} />}
          <input name="email" type="email" required placeholder="이메일" className={inputCls} autoComplete="email" />
          <input name="password" type="password" required placeholder="비밀번호 (6자 이상)" className={inputCls}
                 autoComplete={signup ? "new-password" : "current-password"} />
          <Submit>{signup ? "가입하고 시작하기" : "로그인"}</Submit>
        </form>
        <p className="mt-4 text-center text-sm text-[#8B6A66]">
          {signup ? "이미 계정이 있나요? " : "처음이신가요? "}
          <a href={`/login?${new URLSearchParams(Object.entries({ mode: signup ? "" : "signup", next: sp.next, ref: sp.ref }).filter(([, v]) => v) as [string, string][]).toString()}`} className="font-semibold text-[#7A1F2B]">
            {signup ? "로그인" : "회원가입"}
          </a>
        </p>
      </Card>
    </Page>
  );
}
