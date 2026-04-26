"use client";

/**
 * /queue — Application tracking queue.
 * Applications are created when you "Approve & Pre-fill" via the Chrome extension.
 */

export default function QueuePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Application Queue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Jobs you've approved via the Chrome extension appear here for tracking.
        </p>
      </div>

      <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
        <div className="text-4xl mb-3">🚀</div>
        <p className="font-medium">No applications yet</p>
        <p className="text-sm mt-2 max-w-sm mx-auto">
          Install the Chrome extension, open a job on Greenhouse, score your match,
          then click <strong>Approve &amp; Pre-fill</strong> to track it here.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4">
        {[
          { label: "Applied", count: 0, color: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "Interviewing", count: 0, color: "bg-purple-50 border-purple-200 text-purple-700" },
          { label: "Offered", count: 0, color: "bg-green-50 border-green-200 text-green-700" },
        ].map((stat) => (
          <div key={stat.label} className={`border rounded-lg p-4 text-center ${stat.color}`}>
            <div className="text-3xl font-bold">{stat.count}</div>
            <div className="text-sm mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
