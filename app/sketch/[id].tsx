import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { Canvas, Group, Path, Rect, Image as SkiaImage, useImage } from '@shopify/react-native-skia';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Importance, SketchImage, SketchPaper, SketchStroke, SketchStrokeKind } from '@/types';
import { emptySketchDraft, useSketchesStore, type SketchDraft } from '@/store/useSketchesStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useTasksStore } from '@/store/useTasksStore';
import { useTheme } from '@/theme/ThemeProvider';
import { ColorPicker } from '@/components/ColorPicker';
import { LinkPicker, type LinkOption } from '@/components/LinkPicker';
import { Sheet } from '@/components/Sheet';
import { Button, Field, SectionTitle } from '@/components/ui';
import { formatTime } from '@/lib/date';
import { SKETCH_PENS, type SketchPenKey } from '@/lib/sketchPens';
import { saveImageAttachments } from '@/lib/attachments';
import { describeRecurrence } from '@/lib/recurrence';
import {
  HANDLE_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  clamp,
  clampTranslate,
  fitScale,
  imageAt,
  onResizeHandle,
  strokeBottom,
  toPage,
  toScreen,
  zoomAbout,
  type Transform,
  type Viewport,
} from '@/lib/sketchGeom';
import { GROW_BY, GROW_MARGIN } from '@/lib/sketchGeom';
import { paperPath, paperStroke, strokeToPath } from '@/lib/sketchPaths';

/**
 * The scribble page.
 *
 * The canvas owns the whole screen and is *not* inside a ScrollView. That is the
 * central design decision and it fixes two problems at once: the page used to be
 * wider than the phone with no way to reach the right-hand side, and the draw
 * gesture used to bail out after 10px of vertical travel, so any real scribble
 * scrolled the form instead of drawing. With nothing to yield to, the pen simply
 * wins — there are no activation offsets on it at all.
 *
 * Three things here are the way they are for reasons that are easy to undo by
 * accident, so they are spelled out at their call sites below:
 *  - the transform is plain React state, not Reanimated shared values;
 *  - stroke coordinates come from `onTouchesMove`, never from `event.x`;
 *  - every gesture is composed with `Simultaneous` and arbitrated in JS.
 */

const PEN_SIZES = [4, 9, 16] as const;

type Tool = SketchStrokeKind | 'pan' | 'select';

const TOOLS: { kind: Tool; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { kind: 'pan', icon: 'hand-left-outline', label: 'Move the page' },
  { kind: 'select', icon: 'scan-outline', label: 'Select and resize photos' },
  { kind: 'pen', icon: 'pencil', label: 'Freehand pen' },
  { kind: 'line', icon: 'remove-outline', label: 'Straight line' },
  { kind: 'rect', icon: 'square-outline', label: 'Rectangle' },
  { kind: 'ellipse', icon: 'ellipse-outline', label: 'Ellipse' },
  { kind: 'arrow', icon: 'arrow-redo-outline', label: 'Arrow' },
];

const PAPERS: { kind: SketchPaper; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { kind: 'plain', icon: 'square-outline', label: 'Plain paper' },
  { kind: 'ruled', icon: 'reorder-four-outline', label: 'Ruled lines' },
  { kind: 'grid', icon: 'grid-outline', label: 'Grid' },
  { kind: 'dots', icon: 'apps-outline', label: 'Dots' },
];

const isDrawTool = (tool: Tool): tool is SketchStrokeKind => tool !== 'pan' && tool !== 'select';

/** Who owns the current interaction. First claim wins until every finger lifts. */
type Owner = 'draw' | 'nav' | 'image' | null;

/** What a one-finger drag decided to do, at touch-down. */
type DragMode = 'draw' | 'pan' | 'move' | 'resize' | 'none';

export default function SketchEditor() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const sketch = useSketchesStore((s) => (isNew ? undefined : s.sketches[id]));
  const addSketch = useSketchesStore((s) => s.addSketch);
  const updateSketch = useSketchesStore((s) => s.updateSketch);
  const deleteSketch = useSketchesStore((s) => s.deleteSketch);
  const notes = useNotesStore((s) => s.notes);
  const tasks = useTasksStore((s) => s.tasks);

  const stylusOnly = useSettingsStore((s) => s.sketchStylusOnly);
  const setStylusOnly = useSettingsStore((s) => s.setSketchStylusOnly);

  const initial: SketchDraft = useMemo(() => {
    if (sketch) {
      return {
        title: sketch.title,
        strokes: sketch.strokes,
        images: sketch.images,
        paper: sketch.paper,
        pageW: sketch.pageW,
        pageH: sketch.pageH,
        importance: sketch.importance,
        linkedNoteIds: sketch.linkedNoteIds,
        linkedTaskIds: sketch.linkedTaskIds,
      };
    }
    return emptySketchDraft();
    // Snapshot once — seeds local state, must not clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState(initial.title);
  const [strokes, setStrokes] = useState<SketchStroke[]>(initial.strokes);
  const [images, setImages] = useState<SketchImage[]>(initial.images);
  const [paper, setPaper] = useState<SketchPaper>(initial.paper);
  const [pageW] = useState(initial.pageW);
  const [pageH, setPageH] = useState(initial.pageH);
  const [importance, setImportance] = useState<Importance>(initial.importance);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>(initial.linkedNoteIds);
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>(initial.linkedTaskIds);

  const [tool, setTool] = useState<Tool>('pen');
  const [penKey, setPenKey] = useState<SketchPenKey>('b');
  const [penSize, setPenSize] = useState<number>(9);
  const [current, setCurrent] = useState<SketchStroke | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<Viewport>({ width: 0, height: 0 });

  // ---- The transform ------------------------------------------------------
  /**
   * Pan and zoom are plain React state, mirrored into a ref for the gesture
   * callbacks to read synchronously.
   *
   * Reanimated shared values would move the transform onto the UI thread, and
   * that is the obvious thing to reach for — but Skia's reanimated container
   * tears down and rebuilds its mapper on *every* React render inside <Canvas>
   * (sksg/Container.native.js `redraw`), and a live stroke renders on every
   * touch move. Mixing the two makes the hot path worse, not better, and it puts
   * an untested code path (shared values have never run in this app) under the
   * one screen that must not crash. State keeps the exact render pipeline that
   * already ships. The upgrade is to move the *live stroke* off React state
   * first, then the transform — verified on a device, not here.
   */
  const [xform, setXform] = useState<Transform>({ tx: 0, ty: 0, scale: 1 });
  const xf = useRef<Transform>(xform);
  const viewRef = useRef<Viewport>(view);
  // The page grows while drawing, and the clamp needs the live height.
  const pageHRef = useRef(pageH);
  pageHRef.current = pageH;

  const setTransform = useCallback(
    (next: Transform) => {
      const c = clampTranslate(next, pageW, pageHRef.current, viewRef.current);
      xf.current = c; // ref first: gesture callbacks read it on the next event
      setXform(c);
    },
    [pageW],
  );

  /** Fit the page width to the screen — the sane opening view for a tall page. */
  const fitToWidth = useCallback(
    (v: Viewport = viewRef.current) => {
      if (!v.width) return;
      const s = fitScale(pageW, v);
      setTransform({ scale: s, tx: (v.width - pageW * s) / 2, ty: 0 });
    },
    [pageW, setTransform],
  );

  const onCanvasLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === viewRef.current.width && height === viewRef.current.height) return;
    const first = !viewRef.current.width;
    viewRef.current = { width, height };
    setView({ width, height });
    // First measurement: open at fit-to-width rather than an arbitrary corner.
    if (first) fitToWidth({ width, height });
    else setTransform(xf.current);
  };

  // ---- Persistence --------------------------------------------------------

  const abandoned = useRef(false);
  const createdId = useRef<string | null>(null);

  // `paper` counts: changing only the ruling is a real edit, and without it a
  // brand-new sketch whose one change was "grid" would refuse to save.
  const hasContent =
    title.trim().length > 0 || strokes.length > 0 || images.length > 0 || paper !== 'plain';

  const latest = useRef({
    title, strokes, images, paper, pageW, pageH, importance, linkedNoteIds, linkedTaskIds, hasContent,
  });
  latest.current = {
    title, strokes, images, paper, pageW, pageH, importance, linkedNoteIds, linkedTaskIds, hasContent,
  };

  const persist = useCallback(() => {
    if (abandoned.current) return;
    const cur = latest.current;
    if (!cur.hasContent) return;

    const payload = {
      title: cur.title.trim(),
      strokes: cur.strokes,
      images: cur.images,
      paper: cur.paper,
      pageW: cur.pageW,
      pageH: cur.pageH,
      importance: cur.importance,
      linkedNoteIds: cur.linkedNoteIds,
      linkedTaskIds: cur.linkedTaskIds,
    };

    if (isNew) {
      if (createdId.current) updateSketch(createdId.current, payload);
      else createdId.current = addSketch(payload);
    } else {
      updateSketch(id, payload);
    }
  }, [isNew, id, addSketch, updateSketch]);

  React.useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => persist());
    return unsub;
  }, [navigation, persist]);

  /** OneNote-style: the sheet gets taller as you reach the bottom of it. */
  const growIfNeeded = useCallback((bottom: number) => {
    setPageH((h) => (bottom > h - GROW_MARGIN ? h + GROW_BY : h));
  }, []);

  // ---- Strokes ------------------------------------------------------------

  const penColor = SKETCH_PENS.find((p) => p.key === penKey)!.color;

  const startStroke = (px: number, py: number) => {
    const point = { x: clamp(px, 0, pageW), y: clamp(py, 0, pageHRef.current) };
    const kind = tool as SketchStrokeKind;
    setCurrent({
      id: 'current',
      kind,
      color: penColor,
      size: penSize,
      points: kind === 'pen' ? [point] : undefined,
      x0: kind === 'pen' ? undefined : point.x,
      y0: kind === 'pen' ? undefined : point.y,
      x1: kind === 'pen' ? undefined : point.x,
      y1: kind === 'pen' ? undefined : point.y,
    });
  };

  const extendStroke = (px: number, py: number) => {
    setCurrent((cur) => {
      if (!cur) return cur;
      const point = { x: clamp(px, 0, pageW), y: clamp(py, 0, pageHRef.current) };
      if (cur.kind !== 'pen') return { ...cur, x1: point.x, y1: point.y };
      const pts = cur.points ?? [];
      const last = pts[pts.length - 1];
      // Drop points the eye cannot separate. A fast scribble fires far more move
      // events than there are pixels, and each one is a render inside <Canvas>.
      if (last && Math.abs(last.x - point.x) < 1.2 && Math.abs(last.y - point.y) < 1.2) return cur;
      return { ...cur, points: [...pts, point] };
    });
  };

  const commitStroke = () => {
    setCurrent((cur) => {
      if (!cur) return null;
      const inked =
        cur.kind === 'pen'
          ? (cur.points?.length ?? 0) >= 1
          : cur.x1 !== cur.x0 || cur.y1 !== cur.y0;
      if (inked) {
        const done = { ...cur, id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}` };
        setStrokes((all) => [...all, done]);
        growIfNeeded(strokeBottom(done));
      }
      return null;
    });
  };

  const discardStroke = () => setCurrent(null);
  const undo = () => setStrokes((cur) => cur.slice(0, -1));

  // ---- Images -------------------------------------------------------------

  const selected = useMemo(
    () => images.find((img) => img.id === selectedId) ?? null,
    [images, selectedId],
  );

  const addPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    // Copy into app storage — picker URIs are revocable.
    const [saved] = await saveImageAttachments([asset]);
    if (!saved) return;
    const width = Math.min(560, pageW / 2);
    const ratio = asset.height && asset.width ? asset.height / asset.width : 1;
    const height = Math.min(width * ratio, 900);
    setPendingImage({ uri: saved.uri, width, height });
  };

  const placeImage = (px: number, py: number) => {
    if (!pendingImage) return;
    const img: SketchImage = {
      id: `img${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      uri: pendingImage.uri,
      x: clamp(px - pendingImage.width / 2, 0, Math.max(0, pageW - pendingImage.width)),
      y: clamp(py - pendingImage.height / 2, 0, Math.max(0, pageHRef.current - pendingImage.height)),
      width: pendingImage.width,
      height: pendingImage.height,
    };
    setImages((cur) => [...cur, img]);
    setPendingImage(null);
    growIfNeeded(img.y + img.height);
    // Land in Select, so moving and resizing it is the obvious next step.
    setSelectedId(img.id);
    setTool('select');
  };

  /**
   * Take a photo off the page. The copy in app storage is *not* deleted here —
   * `updateSketch` sweeps it when the new list is actually saved, so being killed
   * between this tap and the save cannot leave the stored sketch pointing at a
   * file that no longer exists.
   */
  const deleteSelected = () => {
    if (!selected) return;
    const gone = selected.id;
    setImages((cur) => cur.filter((img) => img.id !== gone));
    setSelectedId(null);
  };

  // ---- Gestures -----------------------------------------------------------
  /**
   * Everything is composed with `Simultaneous` and arbitrated here in JS.
   *
   * `Race` and `Exclusive` both looked right and are both wrong: `Race` blocks
   * the pinch for the rest of the interaction as soon as the pen activates, and
   * `Exclusive(nav, draw)` makes the pen wait for a pinch that cannot fail until
   * every finger lifts — a drawing surface that hesitates before the line
   * appears. `Simultaneous` has no activation race at all, and the arbiter below
   * decides who is allowed to act.
   */
  const act = useRef<{
    owner: Owner;
    /** The pointer the stroke is following. See onTouchesMove for why. */
    pointerId: number | null;
    stylus: boolean;
    downX: number;
    downY: number;
    pinchLast: number;
    mode: DragMode;
    image: SketchImage | null;
    ratio: number;
  }>({
    owner: null, pointerId: null, stylus: false, downX: 0, downY: 0,
    pinchLast: 1, mode: 'none', image: null, ratio: 1,
  });

  const claim = (owner: Exclude<Owner, null>) => {
    if (act.current.owner === null) {
      act.current.owner = owner;
      return true;
    }
    return act.current.owner === owner;
  };
  const release = (owner: Owner) => {
    if (act.current.owner === owner) {
      act.current.owner = null;
      act.current.pointerId = null;
    }
  };

  const decideMode = (screenX: number, screenY: number): DragMode => {
    // Placing a photo is a tap, so a drag while one is pending just moves the page.
    if (pendingImage) return 'pan';
    if (tool === 'pan') return 'pan';
    if (tool === 'select') {
      if (selected && onResizeHandle(selected, screenX, screenY, xf.current)) {
        act.current.image = selected;
        act.current.ratio = selected.height / selected.width;
        return 'resize';
      }
      const p = toPage(screenX, screenY, xf.current);
      const hit = imageAt(images, p.x, p.y);
      if (hit) {
        setSelectedId(hit.id);
        act.current.image = hit;
        return 'move';
      }
      return 'pan';
    }
    // Palm rejection: with stylus mode on only the pen marks the page, and
    // anything else — finger, palm, knuckle — moves it instead. RNGH maps
    // MotionEvent.TOOL_TYPE_PALM to PointerType.OTHER, so testing for STYLUS
    // rather than against TOUCH is what actually excludes a palm.
    if (stylusOnly && !act.current.stylus) return 'pan';
    return 'draw';
  };

  let onePan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onTouchesDown((e) => {
      // A second finger arriving during a stroke means this was meant as a
      // two-finger pan or pinch, not as a mark. Throw the stub away rather than
      // committing it, or every attempt to move the page with a pen selected
      // would leave a dot behind. Under stylus mode the extra pointer is a palm
      // and the stroke must survive it, so only bail out when stylus mode is off.
      if (act.current.owner === 'draw' && e.numberOfTouches > 1) {
        if (!stylusOnly) {
          discardStroke();
          act.current.mode = 'none';
          // Hand the interaction back, or the two-finger handlers below stay
          // locked out for as long as the fingers are down.
          release('draw');
        }
        return;
      }
      if (e.numberOfTouches !== 1) {
        // Two fingers landed together. Invalidate the latch so onStart cannot
        // fall through to the previous interaction's coordinates and tool type.
        act.current.pointerId = null;
        act.current.stylus = false;
        return;
      }
      if (act.current.owner !== null) return;
      const touch = e.allTouches[0];
      // RNGH latches pointerType at ACTION_DOWN and never revisits it, so this
      // is the one moment the tool type can be read. (A palm that lands *before*
      // the stylus therefore reports a touch — not fixable from here.)
      act.current.stylus = e.pointerType === PointerType.STYLUS;
      act.current.pointerId = touch.id;
      act.current.downX = touch.x;
      act.current.downY = touch.y;
    })
    .onStart(() => {
      // No latched pointer means this interaction did not begin as a clean
      // single touch — leave it to the two-finger handlers.
      if (act.current.pointerId === null) return;
      const mode = decideMode(act.current.downX, act.current.downY);
      if (mode === 'draw') {
        if (selectedId != null || !claim('draw')) return;
        act.current.mode = 'draw';
        const p = toPage(act.current.downX, act.current.downY, xf.current);
        startStroke(p.x, p.y);
        return;
      }
      if (!claim(mode === 'pan' ? 'nav' : 'image')) return;
      act.current.mode = mode;
    })
    .onTouchesUp((e) => {
      // Every finger gone: drop the latch so the next touch starts clean even if
      // this gesture never activated and so never reached onFinalize.
      if (e.numberOfTouches === 0) {
        act.current.pointerId = null;
        act.current.stylus = false;
      }
    })
    .onTouchesMove((e) => {
      if (act.current.owner !== 'draw') return;
      // NEVER use event.x/event.y for ink. GestureHandler.kt calls
      // getLastPointerX(event, true) with averageTouches hardcoded to true, so a
      // pan's x/y is the *centroid of every active pointer* — a resting palm
      // would drag the line towards itself. Follow the latched pointer instead.
      const touch = e.allTouches.find((p) => p.id === act.current.pointerId);
      if (!touch) return;
      const p = toPage(touch.x, touch.y, xf.current);
      extendStroke(p.x, p.y);
    })
    .onChange((e) => {
      const a = act.current;
      if (a.mode === 'draw' || a.mode === 'none') return;
      // A second finger means the two-finger handlers own the view now.
      if (e.numberOfPointers !== 1) return;

      if (a.mode === 'pan') {
        // Incremental, never `translationX`: Android rebases a pan's offset
        // whenever a pointer goes down or up, so only the deltas are continuous.
        const c = xf.current;
        setTransform({ ...c, tx: c.tx + e.changeX, ty: c.ty + e.changeY });
        return;
      }

      const base = a.image;
      if (!base) return;
      // Image edits are in page units, so the photo tracks the finger by the
      // same distance however far in you are zoomed.
      const dx = e.changeX / xf.current.scale;
      const dy = e.changeY / xf.current.scale;
      if (a.mode === 'move') {
        setImages((cur) =>
          cur.map((img) =>
            img.id === base.id
              ? {
                  ...img,
                  x: clamp(img.x + dx, 0, Math.max(0, pageW - img.width)),
                  y: clamp(img.y + dy, 0, Math.max(0, pageHRef.current - img.height)),
                }
              : img,
          ),
        );
      } else if (a.mode === 'resize') {
        setImages((cur) =>
          cur.map((img) => {
            if (img.id !== base.id) return img;
            // Corner drag keeps the aspect ratio captured at grab time.
            const width = clamp(img.width + dx, 60, pageW - img.x);
            const height = clamp(width * a.ratio, 60, pageHRef.current - img.y);
            return { ...img, width, height };
          }),
        );
      }
    })
    .onFinalize(() => {
      const a = act.current;
      if (a.mode === 'draw') commitStroke();
      if (a.mode === 'move' || a.mode === 'resize') {
        const moved = images.find((img) => img.id === a.image?.id);
        if (moved) growIfNeeded(moved.y + moved.height);
      }
      a.mode = 'none';
      a.image = null;
      release('draw');
      release('nav');
      release('image');
    });

  // With stylus mode on, an extra pointer must NOT cancel the stroke: RNGH's
  // maxPointers check calls cancel() once the gesture is active, which is
  // precisely a resting palm killing the line. Without stylus mode the same
  // cancel is what we want — it ends the stroke cleanly and frees the pinch.
  if (!stylusOnly) onePan = onePan.maxPointers(1);

  const navPan = Gesture.Pan()
    .runOnJS(true)
    .minPointers(2)
    .minDistance(0)
    .averageTouches(true)
    .onChange((e) => {
      if (act.current.owner === 'draw') return; // that second pointer is a palm
      if (!claim('nav')) return;
      const c = xf.current;
      setTransform({ ...c, tx: c.tx + e.changeX, ty: c.ty + e.changeY });
    })
    .onFinalize(() => release('nav'));

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      act.current.pinchLast = 1;
    })
    .onUpdate((e) => {
      if (act.current.owner === 'draw') return;
      if (!claim('nav')) return;
      // Pinch scale is cumulative from activation, so convert to a per-frame
      // ratio. Applying it incrementally is what lets the two-finger pan above
      // run at the same time without the two of them fighting over tx/ty.
      const ratio = e.scale / act.current.pinchLast;
      act.current.pinchLast = e.scale;
      setTransform(zoomAbout(xf.current, xf.current.scale * ratio, e.focalX, e.focalY));
    })
    .onFinalize(() => release('nav'));

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(280)
    .maxDistance(14)
    .onEnd((e) => {
      const p = toPage(e.x, e.y, xf.current);
      if (pendingImage) {
        placeImage(p.x, p.y);
        return;
      }
      if (tool !== 'select') return;
      setSelectedId(imageAt(images, p.x, p.y)?.id ?? null);
    });

  /** Long-press grabs a photo even from a pen tool, abandoning the stray mark. */
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(380)
    .maxDistance(16)
    .onStart((e) => {
      const p = toPage(e.x, e.y, xf.current);
      const hit = imageAt(images, p.x, p.y);
      if (!hit) return; // no-op, so an in-flight stroke carries on untouched
      if (act.current.owner === 'draw') {
        discardStroke();
        act.current.mode = 'none';
        act.current.owner = 'image';
      } else if (!claim('image')) {
        return;
      }
      setSelectedId(hit.id);
      setTool('select');
    });

  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((e) => {
      // Not while a pen is selected: double-tapping should leave two dots on the
      // page, not move the view out from under the hand.
      if (isDrawTool(tool)) return;
      const fit = fitScale(pageW, viewRef.current);
      const target = Math.abs(xf.current.scale - fit) < 0.02 ? clamp(1, MIN_SCALE, MAX_SCALE) : fit;
      setTransform(zoomAbout(xf.current, target, e.x, e.y));
    });

  const gesture = Gesture.Simultaneous(pinch, navPan, onePan, tap, doubleTap, hold);

  // ---- Header -------------------------------------------------------------

  const togglePin = useCallback(() => {
    if (isNew) {
      persist();
      if (createdId.current) useSketchesStore.getState().togglePinned(createdId.current);
      return;
    }
    useSketchesStore.getState().togglePinned(id);
  }, [isNew, id, persist]);
  const pinned = sketch?.pinned ?? false;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isNew ? 'New sketch' : 'Edit sketch',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 2 }}>
          <Pressable
            onPress={togglePin}
            hitSlop={8}
            accessibilityLabel={pinned ? 'Unpin sketch' : 'Pin sketch'}
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={21} color={t.accent} />
          </Pressable>
          <Pressable
            onPress={() => setDetailsOpen(true)}
            hitSlop={8}
            accessibilityLabel="Sketch details"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              padding: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="ellipsis-horizontal" size={19} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 14.5, fontWeight: '700' }}>Details</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, isNew, pinned, t, togglePin]);

  // ---- Details ------------------------------------------------------------

  const linkOptions = useMemo<LinkOption[]>(
    () => [
      ...Object.values(notes)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((note) => ({
          id: note.id,
          title: `📝 ${note.title || 'Untitled'}`,
          subtitle: note.body.trim().slice(0, 60) || undefined,
          importance: note.importance,
        })),
      ...Object.values(tasks)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((task) => ({
          id: task.id,
          title: `☑️ ${task.title}`,
          subtitle: `${formatTime(task.minutes)} · ${describeRecurrence(task.recurrence)}`,
          importance: task.importance,
        })),
    ],
    [notes, tasks],
  );

  const selectedLinkIds = useMemo(
    () => [...linkedNoteIds, ...linkedTaskIds],
    [linkedNoteIds, linkedTaskIds],
  );

  const confirmDelete = () => {
    Alert.alert('Delete sketch', 'This removes the sketch and everything on it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          abandoned.current = true;
          const target = isNew ? createdId.current : id;
          if (target) deleteSketch(target);
          router.back();
        },
      },
    ]);
  };

  const clearAll = () => {
    Alert.alert('Clear the page', 'Remove every stroke and photo from this sketch?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          // Files are swept by updateSketch when the empty list is saved.
          setStrokes([]);
          setImages([]);
          setSelectedId(null);
        },
      },
    ]);
  };

  // ---- Render -------------------------------------------------------------

  const paperColor = t.dark ? '#22222F' : '#FFFFFF';
  const rulingColor = t.dark ? '#33334A' : '#DCE3EB';
  const ruling = useMemo(() => paperPath(paper, pageW, pageH), [paper, pageW, pageH]);
  const rulingPaint = paperStroke(paper);

  const hint = pendingImage
    ? 'Tap the page to drop the photo in.'
    : tool === 'pan'
      ? 'Drag to move the page. Pinch to zoom, double-tap to fit.'
      : tool === 'select'
        ? 'Tap a photo to pick it up, drag to move, pull the corner to resize.'
        : stylusOnly
          ? 'Stylus draws. Fingers move and zoom the page.'
          : 'Draw anywhere. Two fingers move and zoom the page.';

  const frame = selected ? toScreen(selected.x, selected.y, xform) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ---- The page ---- */}
      {/* Measured on this wrapper, not on <Canvas>: Canvas.onLayout is an error
          under Fabric, and app.json has newArchEnabled. */}
      <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onCanvasLayout}>
        <GestureDetector gesture={gesture}>
          <View collapsable={false} style={{ flex: 1 }}>
            {view.width > 0 ? (
              <Canvas style={{ width: view.width, height: view.height }}>
                <Group
                  transform={[
                    { translateX: xform.tx },
                    { translateY: xform.ty },
                    { scale: xform.scale },
                  ]}
                >
                  <Rect x={0} y={0} width={pageW} height={pageH} color={paperColor} />
                  {ruling ? (
                    <Path
                      path={ruling}
                      color={rulingColor}
                      style="stroke"
                      strokeWidth={rulingPaint.width}
                      strokeCap={rulingPaint.round ? 'round' : 'butt'}
                    />
                  ) : null}
                  {images.map((img) => (
                    <PlacedImage key={img.id} img={img} />
                  ))}
                  <CommittedStrokes strokes={strokes} />
                  {current ? <StrokePath stroke={current} /> : null}
                </Group>
              </Canvas>
            ) : null}
          </View>
        </GestureDetector>

        {/* Selection chrome sits above the canvas as ordinary views, because the
            grip has to be a touch target and stay one size on screen however far
            the page is zoomed. */}
        {selected && frame ? (
          <SelectionFrame
            left={frame.x}
            top={frame.y}
            width={selected.width * xform.scale}
            height={selected.height * xform.scale}
            onDelete={deleteSelected}
          />
        ) : null}
      </View>

      {/* ---- Floating toolbar ---- */}
      <View style={{ paddingHorizontal: 10, paddingBottom: insets.bottom + 10, paddingTop: 6 }}>
        <Text
          numberOfLines={1}
          style={{ color: t.textFaint, fontSize: 11.5, textAlign: 'center', paddingBottom: 6 }}
        >
          {hint}
        </Text>

        <View
          style={{
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 4 }}>
            {TOOLS.map((item) => (
              <ToolButton
                key={item.kind}
                icon={item.icon}
                label={item.label}
                active={tool === item.kind}
                onPress={() => {
                  setTool(item.kind);
                  if (item.kind !== 'select') setSelectedId(null);
                }}
              />
            ))}
            <View style={{ width: 1, height: 22, backgroundColor: t.border, marginHorizontal: 2 }} />
            <ToolButton icon="image-outline" label="Add a photo" onPress={() => void addPhoto()} />
            <ToolButton
              icon="arrow-undo-outline"
              label="Undo last stroke"
              disabled={strokes.length === 0}
              onPress={undo}
            />
            <ToolButton icon="ellipsis-vertical" label="Page options" onPress={() => setMenuOpen(true)} />
          </View>

          {isDrawTool(tool) ? (
            <>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                {SKETCH_PENS.map((pen) => (
                  <Pressable
                    key={pen.key}
                    onPress={() => setPenKey(pen.key)}
                    accessibilityLabel={`${pen.label} pen`}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      width: penKey === pen.key ? 28 : 24,
                      height: penKey === pen.key ? 28 : 24,
                      borderRadius: 14,
                      backgroundColor: pen.color,
                      borderWidth: penKey === pen.key ? 3 : 0,
                      borderColor: t.text,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  />
                ))}
                <View style={{ flex: 1 }} />
                {PEN_SIZES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setPenSize(s)}
                    accessibilityLabel={`Stroke width ${s}`}
                    hitSlop={4}
                    style={({ pressed }) => ({
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: penSize === s ? t.accent : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 5 + s * 1.2,
                        height: 5 + s * 1.2,
                        borderRadius: (5 + s * 1.2) / 2,
                        backgroundColor: penSize === s ? t.onAccent : t.textDim,
                      }}
                    />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>

      {/* ---- Page options: paper, stylus mode, zoom, clear ---- */}
      <Sheet
        visible={menuOpen}
        title="Page"
        subtitle={`${Math.round(xform.scale * 100)}% · ${
          PAPERS.find((p) => p.kind === paper)?.label ?? 'Plain paper'
        }`}
        onClose={() => setMenuOpen(false)}
        actions={[
          ...PAPERS.map((p) => ({
            label: p.label,
            hint: paper === p.kind ? 'Current' : undefined,
            icon: p.icon,
            onPress: () => setPaper(p.kind),
          })),
          {
            label: stylusOnly ? 'Stylus mode: on' : 'Stylus mode: off',
            hint: stylusOnly
              ? 'Only the pen draws — rest your palm freely, fingers move the page'
              : 'For a stylus tablet: stops your palm marking the page',
            icon: stylusOnly ? 'pencil' : 'hand-left-outline',
            onPress: () => setStylusOnly(!stylusOnly),
          },
          { label: 'Fit page width', icon: 'resize-outline', onPress: () => fitToWidth() },
          {
            label: 'Clear the page',
            hint: 'Every stroke and photo',
            icon: 'trash-outline',
            destructive: true,
            onPress: clearAll,
          },
        ]}
      />

      {/* ---- Details ---- */}
      <Modal
        visible={detailsOpen}
        animationType="slide"
        onRequestClose={() => setDetailsOpen(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Text style={{ flex: 1, color: t.text, fontSize: 19, fontWeight: '800' }}>Details</Text>
            <Pressable
              onPress={() => setDetailsOpen(false)}
              hitSlop={10}
              accessibilityLabel="Close details"
              style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="close" size={24} color={t.textDim} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 18 }}
            keyboardShouldPersistTaps="handled"
          >
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="Untitled sketch" />

            <View style={{ gap: 10 }}>
              <SectionTitle>Importance</SectionTitle>
              <ColorPicker value={importance} onChange={setImportance} />
            </View>

            <LinkPicker
              label="Linked notes & tasks"
              emptyLabel="Nothing to link yet."
              options={linkOptions}
              selectedIds={selectedLinkIds}
              onChange={(ids) => {
                setLinkedNoteIds(ids.filter((x) => notes[x]));
                setLinkedTaskIds(ids.filter((x) => tasks[x]));
              }}
              onOpen={(linkId) => {
                setDetailsOpen(false);
                if (notes[linkId]) router.push({ pathname: '/note/[id]', params: { id: linkId } });
                else if (tasks[linkId]) router.push({ pathname: '/task/[id]', params: { id: linkId } });
              }}
            />

            {!isNew || createdId.current ? (
              <Button
                label="Delete sketch"
                icon="trash-outline"
                variant="danger"
                onPress={() => {
                  setDetailsOpen(false);
                  confirmDelete();
                }}
              />
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: 0.7 }}>
              <Ionicons name="cloud-done-outline" size={14} color={t.textFaint} />
              <Text style={{ color: t.textFaint, fontSize: 12 }}>Changes save when you go back.</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
        borderRadius: 11,
        backgroundColor: active ? t.accent : 'transparent',
        opacity: disabled ? 0.3 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={active ? t.onAccent : t.textDim} />
    </Pressable>
  );
}

function StrokePath({ stroke }: { stroke: SketchStroke }) {
  const path = strokeToPath(stroke);
  if (!path) return null;
  return (
    <Path
      path={path}
      color={stroke.color}
      style="stroke"
      strokeWidth={stroke.size}
      strokeCap="round"
      strokeJoin="round"
    />
  );
}

/**
 * Memoised deliberately. Every point of a live stroke is a render, and without
 * this the whole committed drawing rebuilt its Skia paths on each one — O(strokes)
 * work per touch move, which is what made a well-used page feel sticky.
 */
const CommittedStrokes = React.memo(function CommittedStrokes({
  strokes,
}: {
  strokes: SketchStroke[];
}) {
  return (
    <>
      {strokes.map((s) => (
        <StrokePath key={s.id} stroke={s} />
      ))}
    </>
  );
});

/** A placed photo. Skia needs its decoded bitmap, so load via useImage. */
function PlacedImage({ img }: { img: SketchImage }) {
  const image = useImage(img.uri);
  if (!image) return null;
  return (
    <SkiaImage image={image} x={img.x} y={img.y} width={img.width} height={img.height} fit="fill" />
  );
}

/** Dashed frame, a corner grip and a remove button around the selected photo. */
function SelectionFrame({
  left,
  top,
  width,
  height,
  onDelete,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  onDelete: () => void;
}) {
  const t = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left, top, width, height }}>
      <View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFill,
          borderWidth: 2,
          borderColor: t.accent,
          borderStyle: 'dashed',
          borderRadius: 2,
        }}
      />
      {/* The grip is painted here; the touch test for it lives in
          sketchGeom.onResizeHandle, in screen space, so both agree at any zoom. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: -HANDLE_SIZE / 2,
          bottom: -HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: HANDLE_SIZE / 2,
          backgroundColor: t.accent,
          borderWidth: 2,
          borderColor: t.onAccent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="resize-outline" size={12} color={t.onAccent} />
      </View>
      <Pressable
        onPress={onDelete}
        hitSlop={10}
        accessibilityLabel="Remove this photo"
        style={({ pressed }) => ({
          position: 'absolute',
          left: -HANDLE_SIZE / 2,
          top: -HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: HANDLE_SIZE / 2,
          backgroundColor: t.danger,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="close" size={14} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}
