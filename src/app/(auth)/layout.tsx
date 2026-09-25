import Image from "next/image";

/** Two-panel sign-in shell carried over from the original portal design. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-5 py-8">
      <div className="flex w-full max-w-[900px] overflow-hidden rounded-2xl bg-white shadow-[0_20px_55px_rgba(18,32,50,0.13)]">
        <section
          aria-hidden="true"
          className="relative hidden w-[43%] items-center justify-center overflow-hidden bg-gradient-to-br from-brand-navy-900 via-brand-navy-800 to-brand-navy-700 p-10 text-white md:flex"
        >
          <div className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 size-72 rounded-full border border-white/10" />
          <div className="relative flex flex-col items-center text-center">
            <p className="text-xl font-semibold leading-snug tracking-wide">
              WELCOME TO PHOENIX
              <br />
              SOLUTIONS GROUP
            </p>
            <p className="mt-3 text-sm italic text-white/75">&ldquo;It&rsquo;s All About Performance...&rdquo;</p>
            {/* The logo is white artwork, so it sits directly on the navy panel. */}
            <Image src="/brand/site_logo.png" alt="" width={1251} height={351} className="mt-8 h-auto w-56" priority />            <span className="mt-6 rounded-full border border-white/25 px-4 py-1 text-xs font-medium uppercase tracking-widest">
              Survey Portal
            </span>
          </div>
        </section>
        <section className="flex flex-1 items-center justify-center p-8 sm:p-12">
          <div className="w-full max-w-sm">
            {/* Small screens hide the brand panel, so the logo moves above the form. */}
            <div className="mb-8 flex justify-center rounded-xl bg-brand-navy-900 px-6 py-4 md:hidden">
              <Image src="/brand/site_logo.png" alt="Phoenix Solutions Group" width={1251} height={351} className="h-auto w-40" priority />
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
