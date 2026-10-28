import {type Author} from "@/interfaces/author";
import Link from "next/link";
import Avatar from "./avatar";
import CoverImage from "./cover-image";
import DateFormatter from "./date-formatter";
import {TagsList} from "@/app/_components/tags-list";

type Props = {
  title: string;
  coverImage: string;
  date: string;
  excerpt: string;
  author: Author;
  slug: string;
  tags: string[];
  showCoverImage?: boolean;
  preview?: boolean
};

export function PostPreview({
                              title,
                              coverImage,
                              date,
                              excerpt,
                              author,
                              slug,
                              tags,
                              showCoverImage = false,
                              preview = false
                            }: Props) {
  return (
    <div>
      {showCoverImage && coverImage && (
        <div className="mb-5">
          <CoverImage slug={slug} title={title} src={coverImage}/>
        </div>
      )}

      {preview && (
        <span className="inline-block px-3 py-1 mr-2 mb-2 bg-black  text-xs font-light text-white">
            Preview
        </span>
      )}

      <h3 className="text-2xl mb-3 leading-snug">
        <Link href={`/posts/${slug}`} className="hover:underline">
          {title}
        </Link>
      </h3>

      <p className="text-base leading-relaxed mb-4">{excerpt}</p>

      {tags && tags.length > 0 && (
        <div className="mb-4">
          <TagsList tags={tags}/>
        </div>
      )}

      <div className="flex flex-row items-center justify-between">
        {author && <Avatar name={author.name} picture={author.picture}/>}
        {date && <div className="text-sm text-gray-500 dark:text-gray-300">
          <DateFormatter dateString={date}/>
        </div>}
      </div>
    </div>
  );
}
