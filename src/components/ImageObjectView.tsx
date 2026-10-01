import { clampCrop } from '../geometry/images';
import type { ImageObject } from '../model/types';

interface Props {
  o: ImageObject;
  zoom: number;
}

/**
 * Draws the cropped region of the image, scaled to fill the object's box.
 *
 * The crop is applied by oversizing the <img> inside an overflow-hidden box
 * and offsetting it, rather than with `object-fit`, because that generalises
 * to any crop rectangle rather than just centre-cropping.
 *
 * Rotation is NOT applied here: it is a transform on the wrapper in
 * ObjectLayer, so the selection outline and handles rotate with the image
 * instead of staying stubbornly axis-aligned around it.
 */
export function ImageObjectView({ o, zoom }: Props) {
  const crop = clampCrop(o.crop);
  const w = o.width * zoom;
  const h = o.height * zoom;

  // Scaling the full image by 1/crop makes the cropped region exactly fill
  // the box; the offset then slides the wanted region into view.
  const fullWidth = w / crop.width;
  const fullHeight = h / crop.height;

  return (
    <div
      className="pointer-events-none overflow-hidden"
      style={{ width: w, height: h, opacity: o.opacity }}
    >
      <img
        src={o.src}
        alt=""
        draggable={false}
        className="max-w-none select-none"
        style={{
          width: fullWidth,
          height: fullHeight,
          marginLeft: -crop.x * fullWidth,
          marginTop: -crop.y * fullHeight,
        }}
      />
    </div>
  );
}

/**
 * The image shown while cropping: the whole source at reduced opacity, with
 * the kept region punched through at full strength.
 *
 * Seeing what is being discarded is the entire point of a crop UI — without
 * it you are dragging edges against a guess.
 */
export function CropPreview({ o, zoom }: Props) {
  const crop = clampCrop(o.crop);
  const w = o.width * zoom;
  const h = o.height * zoom;

  const fullWidth = w / crop.width;
  const fullHeight = h / crop.height;
  const offsetX = -crop.x * fullWidth;
  const offsetY = -crop.y * fullHeight;

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: offsetX, top: offsetY, width: fullWidth, height: fullHeight }}
    >
      <img
        src={o.src}
        alt=""
        draggable={false}
        className="max-w-none select-none opacity-30"
        style={{ width: fullWidth, height: fullHeight }}
      />
      <div
        className="absolute overflow-hidden ring-1 ring-accent"
        style={{
          left: crop.x * fullWidth,
          top: crop.y * fullHeight,
          width: w,
          height: h,
        }}
      >
        <img
          src={o.src}
          alt=""
          draggable={false}
          className="max-w-none select-none"
          style={{
            width: fullWidth,
            height: fullHeight,
            marginLeft: -crop.x * fullWidth,
            marginTop: -crop.y * fullHeight,
          }}
        />
      </div>
    </div>
  );
}
