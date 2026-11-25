// Office layout data. Grid units are tiles; the office is GRID_W x GRID_H.
// Later phases (characters, agent mapping) read desks and rooms from here.

export const GRID_W = 20
export const GRID_H = 14
export const WALL_H = 40
export const PARTITION_H = 14

export type RoomId = 'dev' | 'meeting' | 'server' | 'lounge' | 'pantry'

export interface Room {
  id: RoomId
  name: string
  x0: number
  y0: number
  x1: number
  y1: number
  floorA: string
  floorB: string
  accent: string
  /** Where the name plate floats (grid coordinates, floor level). */
  label: { gx: number; gy: number }
}

export const ROOMS: Room[] = [
  { id: 'dev', name: 'DEV ROOM', x0: 0, y0: 0, x1: 11, y1: 8, floorA: '#b98d5c', floorB: '#ae8454', accent: '#f0b35a', label: { gx: 3.2, gy: 7.15 } },
  { id: 'meeting', name: 'MEETING', x0: 11, y0: 0, x1: 20, y1: 8, floorA: '#4d8a92', floorB: '#468189', accent: '#6fd3de', label: { gx: 12.6, gy: 6.9 } },
  { id: 'server', name: 'SERVER', x0: 0, y0: 8, x1: 6, y1: 14, floorA: '#3a4152', floorB: '#343a4a', accent: '#7be08a', label: { gx: 3, gy: 13.1 } },
  { id: 'lounge', name: 'LOUNGE', x0: 6, y0: 8, x1: 16, y1: 14, floorA: '#6c5d93', floorB: '#645689', accent: '#c9a2ff', label: { gx: 11, gy: 13.3 } },
  { id: 'pantry', name: 'PANTRY', x0: 16, y0: 8, x1: 20, y1: 14, floorA: '#cdd1da', floorB: '#c3c8d2', accent: '#ffd36b', label: { gx: 18, gy: 13.3 } }
]

export function roomAt(gx: number, gy: number): Room {
  for (const r of ROOMS) {
    if (gx >= r.x0 && gx < r.x1 && gy >= r.y0 && gy < r.y1) return r
  }
  return ROOMS[0]
}

export interface DeskSlot {
  id: string
  roomId: RoomId
  /** Desk top-left corner (grid). Desks are 2 x 1 tiles. */
  gx: number
  gy: number
  /** Where the occupant sits (grid): the middle of the chair behind the right half of the desk. */
  seat: { gx: number; gy: number }
}

// Wide aisle (1.4 tiles) between the first two columns so two agents can pass each other.
const DESK_COLS = [1.5, 4.9, 8.3]
const DESK_ROWS = [2.5, 5.5]

export const DESKS: DeskSlot[] = DESK_ROWS.flatMap((gy, r) =>
  DESK_COLS.map((gx, c) => ({
    id: `desk-${String(r * DESK_COLS.length + c + 1).padStart(2, '0')}`,
    roomId: 'dev' as const,
    gx,
    gy,
    seat: { gx: gx + 1.4, gy: gy - 0.5 }
  }))
)

/** Places idle agents stand around (grid coordinates). Each one is used by at most one agent. */
export const HANGOUTS: Array<{ gx: number; gy: number }> = [
  { gx: 8.0, gy: 11.9 },
  { gx: 9.4, gy: 12.4 },
  { gx: 10.8, gy: 10.0 },
  { gx: 11.0, gy: 13.0 },
  { gx: 13.5, gy: 13.2 },
  { gx: 14.9, gy: 10.0 },
  { gx: 18.2, gy: 10.2 },
  { gx: 19.2, gy: 10.3 },
  { gx: 16.6, gy: 10.2 },
  { gx: 2.8, gy: 10.2 },
  { gx: 4.9, gy: 10.3 }
]

/** Door gaps in the low partition walls: [from, to] along the wall. */
export const DOORS = {
  /** partition at gy = 8, gaps along gx */
  gy8: [
    [3, 5],
    [8, 10],
    [13, 15],
    [18.8, 19.8]
  ] as Array<[number, number]>,
  /** partition at gx = 11 (dev | meeting), gaps along gy */
  gx11: [[3, 5]] as Array<[number, number]>,
  /** partition at gx = 6 (server | lounge) */
  gx6: [[10.5, 12.5]] as Array<[number, number]>,
  /** partition at gx = 16 (lounge | pantry) */
  gx16: [[10.5, 12.5]] as Array<[number, number]>
}
