import {
  DoorIcon,
  BathtubIcon,
  GridNineIcon,
  WarehouseIcon,
  TreeIcon,
  CookingPotIcon,
  StairsIcon,
  RulerIcon,
  HardHatIcon,
  BuildingsIcon,
  BankIcon,
  MoneyIcon,
  DotsThreeIcon,
  DropIcon,
  HammerIcon,
  HouseLineIcon,
  LightningIcon,
  PackageIcon,
  PaintRollerIcon,
  SquaresFourIcon,
  TruckIcon,
  WallIcon,
  WrenchIcon,
  type Icon,
} from "@phosphor-icons/react";

const workIcons: Record<string, Icon> = {
  bath: BathtubIcon,
  grill: GridNineIcon,
  warehouse: WarehouseIcon,
  wood: TreeIcon,
  kitchen: CookingPotIcon,
  stairs: StairsIcon,
  measure: RulerIcon,
  building: BuildingsIcon,
  bricks: WallIcon,
  plumbing: DropIcon,
  door: DoorIcon,
  worker: HardHatIcon,
  other: PackageIcon,
  home: HouseLineIcon,
  tiles: SquaresFourIcon,
  paint: PaintRollerIcon,
  electric: LightningIcon,
  water: DropIcon,
  plaster: WallIcon,
  brick: WallIcon,
  wrench: WrenchIcon,
  steel: HammerIcon,
  cement: PackageIcon,
  sand: TruckIcon,
};
export function WorkMark({
  icon = "home",
  color = "sage",
  size = 26,
}: {
  icon?: string;
  color?: string;
  size?: number;
}) {
  const Icon = workIcons[icon] ?? HouseLineIcon;
  return (
    <span className={`work-mark tone-${color}`}>
      <Icon size={size} weight="duotone" />
    </span>
  );
}
export function PaymentIcon({
  method,
  size = 22,
}: {
  method: string;
  size?: number;
}) {
  if (method === "bkash")
    return (
      <span className="payment-brand bkash">
        <img src="/brands/bkash.svg" width={size} height={size} alt="" />
      </span>
    );
  const Icon =
    method === "cash"
      ? MoneyIcon
      : method === "bank"
        ? BankIcon
        : DotsThreeIcon;
  return (
    <span className={`payment-brand ${method}`}>
      <Icon size={size} weight="duotone" />
    </span>
  );
}

export const workIconChoices = [
  { id: "home", label: "বাড়ি" },
  { id: "building", label: "ঘর" },
  { id: "brick", label: "ইটের কাজ" },
  { id: "cement", label: "সিমেন্ট" },
  { id: "steel", label: "লোহা ও রড" },
  { id: "sand", label: "বালু" },
  { id: "tiles", label: "টাইলস" },
  { id: "paint", label: "রং" },
  { id: "electric", label: "বিদ্যুৎ" },
  { id: "water", label: "পানির লাইন" },
  { id: "bath", label: "বাথরুম" },
  { id: "door", label: "দরজা" },
  { id: "grill", label: "গ্রিল" },
  { id: "wood", label: "কাঠ" },
  { id: "stairs", label: "সিঁড়ি" },
  { id: "kitchen", label: "রান্নাঘর" },
  { id: "warehouse", label: "গুদাম" },
  { id: "worker", label: "মিস্ত্রি" },
  { id: "measure", label: "মাপজোক" },
  { id: "wrench", label: "অন্য কাজ" },
];
export const workColorChoices = [
  { id: "blue", label: "নীল", color: "#3b82f6" },
  { id: "sage", label: "সবুজ", color: "#299e7a" },
  { id: "amber", label: "হলুদ", color: "#dc9a2e" },
  { id: "rose", label: "গোলাপি", color: "#d96094" },
  { id: "lavender", label: "বেগুনি", color: "#9568d9" },
  { id: "coral", label: "কমলা", color: "#df775c" },
  { id: "slate", label: "ধূসর নীল", color: "#71879d" },
  { id: "wood", label: "বাদামি", color: "#ab7e4b" },
  { id: "plum", label: "জাম রং", color: "#af70af" },
  { id: "teal", label: "ফিরোজা", color: "#20a7ad" },
];
