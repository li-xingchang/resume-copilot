import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-53px)] bg-gray-50">
      <SignUp
        appearance={{
          elements: {
            card: "shadow-sm border border-gray-100 rounded-2xl",
            headerTitle: "text-gray-900 font-semibold",
            headerSubtitle: "text-gray-500",
            formButtonPrimary:
              "bg-blue-600 hover:bg-blue-700 text-sm font-medium",
            footerActionLink: "text-blue-600 hover:text-blue-700",
          },
        }}
        fallbackRedirectUrl="/onboard"
        signInUrl="/sign-in"
      />
    </div>
  );
}
