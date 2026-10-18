import React from 'react';

/**
 * Base skeleton primitive. Uses Tailwind's animate-pulse and inherits
 * dimensions from the caller so it can match the loaded content exactly.
 */
export function Skeleton({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-gray-200 ${className}`}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Skeleton for a single loan table row. Mirrors the column layout of the
 * loaded loan table (id, borrower, amount, status, actions).
 */
export function LoanTableRowSkeleton() {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-16" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-6 w-20 rounded-full" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-12" />
      </td>
    </tr>
  );
}

/**
 * Skeleton for the loan table body. Renders a configurable number of rows
 * so the table keeps its height while data loads (prevents CLS).
 */
export function LoanTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <LoanTableRowSkeleton key={i} />
      ))}
    </tbody>
  );
}

/**
 * Skeleton for a dashboard stat card. Matches the loaded card's padding,
 * label height, and value height.
 */
export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-32" />
    </div>
  );
}

/**
 * Skeleton grid for the dashboard stat cards row.
 */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for a single collateral list item. Mirrors the loaded item's
 * avatar/thumbnail, title, subtitle, and trailing value.
 */
export function CollateralListItemSkeleton() {
  return (
    <li className="flex items-center gap-4 border-b border-gray-100 px-4 py-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-16" />
    </li>
  );
}

/**
 * Skeleton list for the collateral items. Renders a configurable number of
 * items so the list keeps its height while data loads (prevents CLS).
 */
export function CollateralListSkeleton({ items = 5 }: { items?: number }) {
  return (
    <ul className="divide-y divide-gray-100">
      {Array.from({ length: items }).map((_, i) => (
        <CollateralListItemSkeleton key={i} />
      ))}
    </ul>
  );
}
