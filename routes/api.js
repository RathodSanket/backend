const express = require("express");
const axios = require("axios");
const Product = require("../models/product.js");

const router = express.Router();

// API to initialize database
router.post("/initialize", async (req, res) => {
  try {
    const url = "https://s3.amazonaws.com/roxiler.com/product_transaction.json";
    const { data } = await axios.get(url);

    await Product.deleteMany(); // Clear existing data
    await Product.insertMany(data); // Seed new data

    res.json({ message: "Database initialized successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to initialize database." });
  }
});

// API to list transactions
router.get("/transactions", async (req, res) => {
  const { month, page = 1, per_page = 10, search = "" } = req.query;
  const skip = (page - 1) * per_page;
  try {
    const query = {
      $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
    };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { price: { $eq: parseFloat(search) } },
      ];
    }

    const total = await Product.countDocuments(query);
    const transactions = await Product.find(query).skip(skip).limit(parseInt(per_page));

    res.json({ page, per_page, total, transactions });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch transactions." });
  }
});

// API for statistics
router.get("/statistics", async (req, res) => {
  const { month } = req.query;
  try {
    const soldItems = await Product.countDocuments({
      $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
      sold: true,
    });
    const notSoldItems = await Product.countDocuments({
      $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
      sold: false,
    });
    const totalSales = await Product.aggregate([
      {
        $match: {
          $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
          sold: true,
        },
      },
      { $group: { _id: null, total: { $sum: "$price" } } },
    ]);

    res.json({
      total_sales: totalSales[0]?.total || 0,
      sold_items: soldItems,
      not_sold_items: notSoldItems,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch statistics." });
  }
});

// API for bar chart
router.get("/bar-chart", async (req, res) => {
  const { month } = req.query;
  const ranges = [
    { min: 0, max: 100 },
    { min: 101, max: 200 },
    { min: 201, max: 300 },
    { min: 301, max: 400 },
    { min: 401, max: 500 },
    { min: 501, max: 600 },
    { min: 601, max: 700 },
    { min: 701, max: 800 },
    { min: 801, max: 900 },
    { min: 901, max: Infinity },
  ];
  try {
    const result = {};
    for (const range of ranges) {
      const count = await Product.countDocuments({
        $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
        price: { $gte: range.min, ...(range.max !== Infinity && { $lte: range.max }) },
      });
      result[`${range.min}-${range.max === Infinity ? "above" : range.max}`] = count;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bar chart data." });
  }
});

// API for pie chart
router.get("/pie-chart", async (req, res) => {
  const { month } = req.query;
  try {
    const categories = await Product.aggregate([
      {
        $match: {
          $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    res.json(
      categories.reduce((acc, category) => {
        acc[category._id] = category.count;
        return acc;
      }, {})
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pie chart data." });
  }
});

// Combined API
router.get("/combined", async (req, res) => {
  const { month } = req.query;
  try {
    const [transactions, stats, barChart, pieChart] = await Promise.all([
      Product.find({
        $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
      }),
      (async () => {
        const soldItems = await Product.countDocuments({
          $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
          sold: true,
        });
        const notSoldItems = await Product.countDocuments({
          $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
          sold: false,
        });
        const totalSales = await Product.aggregate([
          {
            $match: {
              $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] },
              sold: true,
            },
          },
          { $group: { _id: null, total: { $sum: "$price" } } },
        ]);
        return {
          total_sales: totalSales[0]?.total || 0,
          sold_items: soldItems,
          not_sold_items: notSoldItems,
        };
      })(),
      router.handle({ query: { month } }, res), // Reuse bar-chart API
      router.handle({ query: { month } }, res), // Reuse pie-chart API
    ]);

    res.json({ transactions, statistics: stats, bar_chart: barChart, pie_chart: pieChart });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch combined data." });
  }
});

module.exports = router;
