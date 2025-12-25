export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="gradient-card rounded-lg border border-border/50 p-5"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-5 rounded animate-shimmer" />
              <div className="space-y-1">
                <div className="w-24 h-4 rounded animate-shimmer" />
                <div className="w-32 h-3 rounded animate-shimmer" />
              </div>
            </div>
            <div className="w-8 h-8 rounded animate-shimmer" />
          </div>
          <div className="space-y-2">
            <div className="w-full h-4 rounded animate-shimmer" />
            <div className="w-3/4 h-4 rounded animate-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
