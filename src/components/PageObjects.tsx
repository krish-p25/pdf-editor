import type { CSSProperties } from 'react';
import { ShapeObjectView } from './ShapeObjectView';
import { TextObjectView } from './TextObjectView';
import { ImageObjectView } from './ImageObjectView';
import { isImage, isText, type EditorObject } from '../model/types';

/**
 * Where an object sits within its page, at a given scale.
 *
 * Shared by the editing canvas and the thumbnails so the two cannot disagree
 * about placement. Rotation is applied to the wrapper rather than the content
 * so selection chrome turns with the object.
 */
export function objectBoxStyle(o: EditorObject, zoom: number): CSSProperties {
  return {
    left: o.x * zoom,
    top: o.y * zoom,
    width: o.width * zoom,
    height: o.height * zoom,
    transform: isImage(o) && o.rotation ? `rotate(${o.rotation}deg)` : undefined,
  };
}

const noop = () => undefined;

interface Props {
  objects: EditorObject[];
  zoom: number;
}

/**
 * Objects drawn without any interaction, for previews.
 *
 * This deliberately reuses the same view components as the editing canvas
 * rather than drawing a simplified version: a thumbnail that renders its own
 * approximation of a page would drift from the canvas the moment either
 * changed, which is the same trap the text layout avoids by sharing one
 * line-breaking function between the preview and the exporter.
 */
export function PageObjects({ objects, zoom }: Props) {
  return (
    <>
      {objects.map((o) => (
        <div key={o.id} className="pointer-events-none absolute" style={objectBoxStyle(o, zoom)}>
          {isText(o) ? (
            <TextObjectView o={o} zoom={zoom} editing={false} selectAll={false} onFinishEditing={noop} />
          ) : isImage(o) ? (
            <ImageObjectView o={o} zoom={zoom} />
          ) : (
            <ShapeObjectView o={o} zoom={zoom} />
          )}
        </div>
      ))}
    </>
  );
}
