import Container from "@/app/_components/container";
import cn from "classnames";

type Props = {
  preview?: boolean;
};

const PreviewAlert = ({preview}: Props) => {
  return preview && (
    <div
      className={cn("border-b dark:bg-slate-800", {
        "bg-neutral-800 border-neutral-800 text-white": preview,
        "bg-neutral-50 border-neutral-200": !preview,
      })}
    >
      <Container>
        <div className="py-2 text-center text-sm">
          This page is a preview.
        </div>
      </Container>
    </div>
  );
};

export default PreviewAlert;
