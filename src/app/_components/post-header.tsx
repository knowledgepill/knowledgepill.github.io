import Avatar from "./avatar";
import DateFormatter from "./date-formatter";
import {PostTitle} from "@/app/_components/post-title";
import {type Author} from "@/interfaces/author";
import CoverImage from "@/app/_components/cover-image";

type Props = {
  title: string;
  coverImage: string;
  date: string;
  author: Author;
};

export function PostHeader({title, coverImage, date, author}: Props) {
  return (
    <>
      <PostTitle>{title}</PostTitle>

      {coverImage && (
        <div className="mb-4">
          <CoverImage title={title} src={coverImage} />
        </div>
      )}

      <div className="flex mb-10 gap-4 items-center">
        <div className="inline-block">
          <Avatar name={author.name} picture={author.picture}/>
        </div>
        <div className="inline-block text-gray-300">/</div>
        <div className="inline-block text-sm">
          <DateFormatter dateString={date}/>
        </div>
      </div>

    </>
  );
}
