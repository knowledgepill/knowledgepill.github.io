import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import {unified} from "unified";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeFormat from "rehype-format";


export default async function markdownToHtml(markdown: string) {

  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, {allowDangerousHtml: true})
    .use(rehypeRaw)
    .use(rehypeFormat)
    .use(rehypeStringify)

  const result = await processor.process(markdown);

  return result.toString();
}
