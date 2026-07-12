import { ViewportPortal } from '@xyflow/react';
import type { AlignmentGuide } from '../../lib/alignmentSnap';

export function AlignmentGuides({ guides }: { guides: AlignmentGuide[] }) {
  if (guides.length === 0) return null;

  return (
    <ViewportPortal>
      {guides.map((guide) => {
        const vertical = guide.axis === 'x';
        return (
          <div
            key={`${guide.axis}-${guide.referenceId}-${guide.coordinate}`}
            className={`alignment-guide alignment-guide--${vertical ? 'vertical' : 'horizontal'}`}
            style={
              vertical
                ? {
                    left: guide.coordinate,
                    top: guide.from,
                    height: guide.to - guide.from,
                  }
                : {
                    left: guide.from,
                    top: guide.coordinate,
                    width: guide.to - guide.from,
                  }
            }
          />
        );
      })}
    </ViewportPortal>
  );
}
