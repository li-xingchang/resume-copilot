import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/onboard");

  return (
    <div className="flex flex-col min-h-[calc(100vh-53px)]">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-2xl text-center space-y-6">
          {/* Badge */}
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
            AI-powered resume intelligence
          </span>

          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 leading-tight">
            Land more interviews
            <br />
            <span className="text-blue-600">with a resume that fits</span>
          </h1>

          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            Resume Co-Pilot scores your resume against any job, tailors every
            bullet with AI, and pre-fills applications automatically — in one
            click.
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              href="/sign-up"
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
            >
              Get started free
            </Link>
            <Link
              href="/sign-in"
              className="px-6 py-3 text-gray-700 font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Sign in
            </Link>
          </div>

          <p className="text-xs text-gray-400">No credit card required · Free during beta</p>
        </div>
      </section>

      {/* Feature cards */}
      <section className="bg-gray-50 border-t border-gray-100 py-16 px-4">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-3 gap-6">
          {[
            {
              icon: "📊",
              title: "Instant match score",
              body: "See exactly how your resume stacks up against any job description — with a gap-by-gap breakdown.",
            },
            {
              icon: "✍️",
              title: "AI tailoring",
              body: "Every bullet is rewritten to match the role, backed by citations from your real experience.",
            },
            {
              icon: "🚀",
              title: "Auto-fill applications",
              body: "The Chrome extension pre-fills Greenhouse, Lever, Workday and more — one click, zero copy-paste.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-3"
            >
              <div className="text-3xl">{f.icon}</div>
              <h3 className="font-semibold text-gray-900">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white px-6 py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} Resume Co-Pilot · Built with ❤️ for job seekers
      </footer>
    </div>
  );
}
