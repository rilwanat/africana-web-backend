import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '@/prisma-client'
import { logger } from '@/lib/logger'
import { slugifyStr } from '@/lib/helpers'
import dayjs from 'dayjs'

const getProducts = async (req: Request, res: Response) => {
    try {
        const {
            search,
            minPrice,
            maxPrice,
            categorySlug,
            tagSlug,
            color,
            page,
            limit,
            latest,
        } = req.query

        let where = {}

        if (search) {
            where = {
                ...where,
                name: {
                    contains: search
                }
            }
        }

        if (minPrice && maxPrice) {
            where = {
                ...where,
                productVariants: {
                    some: {
                        price: {
                            gte: parseInt(minPrice as string, 10),
                            lte: parseInt(maxPrice as string, 10)
                        }
                    }
                }
            }
        }

        if (categorySlug) {
            where = {
                ...where,
                categories: {
                    some: {
                        slug: categorySlug as string
                    }
                }
            }
        }

        if (tagSlug) {
            where = {
                ...where,
                tags: {
                    some: {
                        slug: tagSlug as string
                    }
                }
            }
        }


        if (color) {
            where = {
                ...where,
                productVariants: {
                    some: {
                        color: color as string
                    }
                }
            }
        }

        if (latest) {
            where = {
                ...where,
                orderBy: {
                    createdAt: 'desc'
                }
            }
        }

        const take = parseInt(limit as string, 10) || 16
        const skip = page ? (parseInt(page as string, 10) * take) - take : 0

        const products = await prisma.product.findMany({
            where,
            include: {
                productVariants: true,
                productImages: true,
            },
            take,
            skip,
        })

        // const updatedProducts = products.map(product => {
        //     const updatedVariants = product.productVariants.map(variant => {
        //         const oldPrice = variant.oldPrice ? getAmount(variant.oldPrice) : null
        //         return { ...variant, price: getAmount(variant.price), oldPrice }
        //     })

        //     return { ...product, productVariants: updatedVariants }
        // })

        const totalProducts = await prisma.product.count({
            where,
        })

        res.json({
            success: true,
            total: totalProducts,
            products
        })
    } catch (error) {
        logger.error(error)
    }
}

const createProduct = async (req: Request, res: Response) => {
    try {
        const categories: number[] = req.body.categories
        const tags: number[] = req.body.tags
        const productVariants: Prisma.ProductVariantCreateInput[] = req.body.productVariants
        const productImages: Prisma.ProductImageCreateInput[] = req.body.productImages

        const product = await prisma.product.create({
            data: {
                name: req.body.name,
                slug: slugifyStr(req.body.name),
                description: req.body.description,
                currencyId: req.body.currency ?? 1,
                lowOnStockMargin: req.body.lowOnStockMargin,
                productVariants: {
                    // create: [
                    //     ...productVariants.map(variant => ({
                    //         ...variant,
                    //         price: setAmount(variant.price),
                    //         oldPrice: variant.oldPrice ? setAmount(variant.oldPrice) : null,
                    //     }))
                    // ],
                    create: productVariants
                },
                productImages: {
                    create: [
                        ...productImages
                    ],
                },
            }
        })

        const productCategoriesAndTags = await prisma.product.update({
            where: { id: product.id },
            data: {
                categories: {
                    connect: [
                        ...categories.map(category => ({
                            id: category,
                        }))
                    ],
                },
                tags: {
                    connect: [
                        ...tags.map(tag => ({
                            id: tag,
                        }))
                    ],
                }
            }
        })

        const totalQuantity = await getProductTotalQuantity(product.id)

        await prisma.product.update({
            where: {
                id: product.id
            },
            data: {
                totalQuantity
            }
        })

        return res.json({
            success: true,
            message: "New product added",
            product: { ...product, ...productCategoriesAndTags }
        })
    } catch (error) {
        logger.error(error)
    }
}

const getProduct = async (req: Request, res: Response) => {
    try {
        const product = await prisma.product.findUnique({
            where: {
                slug: req.params.slug
            },
            include: {
                productVariants: true,
                productImages: true,
                categories: true,
                tags: true,
            }
        })

        if (!product) {
            return res.json({
                success: false,
                message: "Product does not exist"
            })
        }

        // const updatedVariants = product?.productVariants.map(variant => {
        //     return { ...variant, price: getAmount(variant.price), oldPrice: getAmount(variant.price) }
        // })

        // const updatedProduct = { ...product, productVariants: updatedVariants }

        return res.json({
            success: true,
            product
        })
    } catch (error) {
        logger.error(error)
    }
}

const getProductViews = async (req: Request, res: Response) => {
    const productViews = await prisma.productView.findMany({
        orderBy: {
            createdAt: 'desc',
        },
        include: {
            product: {
                select: {
                    name: true,
                    slug: true
                }
            },
            _count: {
                select: { visitors: true }
            }
        }
    })

    return res.json({
        success: true,
        productViews
    })
}

const updateProduct = async (req: Request, res: Response) => {
    try {
        const categories: number[] = req.body.categories
        const tags: number[] = req.body.tags
        const productVariants: Prisma.ProductVariantCreateInput[] = req.body.productVariants
        const productImages: Prisma.ProductImageCreateInput[] = req.body.productImages

        const slug = req.params.slug

        const existingProduct = await prisma.product.findUnique({
            where: { slug },
        })

        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            })
        }

        const newSlug = slugifyStr(req.body.name)
        const isSlugNotAvailable = await prisma.product.findUnique({
            where: {
                slug: newSlug,
                NOT: { slug }
            },
        })

        if (isSlugNotAvailable) {
            return res.status(400).json({
                success: false,
                message: "Product already exists",
            })
        }

        const product = await prisma.product.update({
            where: {
                slug
            },
            data: {
                name: req.body.name,
                slug: newSlug,
                description: req.body.description,
                currencyId: req.body.currency ?? 1,
                lowOnStockMargin: req.body.lowOnStockMargin,
                productVariants: {
                    upsert: productVariants.map(variant => ({
                        where: { sku: variant.sku },
                        update: variant,
                        create: variant
                    }))
                },
                productImages: {
                    upsert: productImages.map(image => ({
                        where: { url: image.url },
                        update: { ...image },
                        create: { ...image }
                    }))
                },
                categories: {
                    set: categories.map(category => ({ id: category }))
                },
                tags: {
                    set: tags.map(tag => ({ id: tag }))
                },
            }
        })

        const totalQuantity = await getProductTotalQuantity(product.id)

        await prisma.product.update({
            where: {
                id: product.id
            },
            data: {
                totalQuantity
            }
        })

        return res.json({
            success: true,
            message: "Product updated",
            product
        })
    } catch (error) {
        logger.error(error)
    }
}

const updateProductViews = async (req: Request, res: Response) => {
    // req.cookies["africana_session_id"]
    const visitor = req.useragent?.source as string

    const product = await prisma.product.findUnique({
        where: {
            slug: req.params.slug
        },
    })

    if (!product) {
        return res.json({
            success: false,
            message: "Product does not exist"
        })
    }

    const today = dayjs()
    const startOfMonth = today.startOf('month').toISOString()
    const endOfMonth = today.endOf('month').toISOString()

    const productView = await prisma.productView.findFirst({
        where: {
            productId: product.id,
            createdAt: {
                gt: startOfMonth,
                lte: endOfMonth
            },
        },
        include: {
            visitors: true
        }
    })

    if (productView) {
        const existingVisitor = productView.visitors.find(v => v.visitor === visitor)

        if (existingVisitor) {
            return res.json({
                success: true,
                message: "Product already viewed by client this month"
            })
        } else {
            const productViewUpdated = await prisma.productView.update({
                where: {
                    id: productView.id,
                },
                data: {
                    visitors: {
                        create: {
                            visitor
                        }
                    }
                }
            })

            if (productViewUpdated) {
                return res.json({
                    success: true,
                    message: "New product view this month"
                })
            }
        }

    } else {
        await prisma.productView.create({
            data: {
                product: {
                    connect: {
                        id: product.id,
                    }
                },
                visitors: {
                    create: {
                        visitor
                    }
                }
            }
        })

        return res.json({
            success: true,
            message: "First product view this month"
        })
    }
}

const deleteProduct = async (req: Request, res: Response) => {
    try {
        await prisma.product.delete({
            where: {
                slug: req.params.slug
            }
        })

        return res.json({
            success: true,
            message: "Product deleted"
        })
    } catch (error) {
        logger.error(error)
    }
}

const getProductTotalQuantity = async (productId: string) => {
    const productVariants = await prisma.productVariant.findMany({
        where: {
            productId: productId
        }
    })

    const totalQuantity = productVariants.reduce((acc, variant) => {
        return acc + variant.quantity
    }, 0)

    return totalQuantity
}

export {
    getProducts,
    createProduct,
    getProduct,
    getProductViews,
    updateProduct,
    updateProductViews,
    deleteProduct,
}